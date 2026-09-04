<?php

namespace Modules\Administration\Requests;

use App\Enums\AccessLevel;
use App\Enums\ClientCapability;
use App\Enums\RoleAudience;
use App\Models\OperatorClient;
use App\Models\User;
use App\Support\Auth\PasswordPolicy;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Models\Role;
use Modules\Administration\Policies\UserPolicy;
use Modules\Administration\Services\SettingsService;
use Modules\Administration\Services\UserAdminService;

/**
 * Onboarding a colleague.
 *
 * Two ways in, and the administrator chooses: an emailed invitation link, or
 * an initial password typed here. This docblock used to say an invite flow
 * "needs a signed, expiring token and a public accept-invite page, neither of
 * which exists" — true when it was written, and false since the invitations
 * table shipped on 24 August. It survived one commit that claimed to delete
 * it, which is its own small lesson about believing a commit message.
 *
 * The address does **not** have to be free. An account that is free to move —
 * a driver applicant, or somebody already here — joins instead of being
 * refused, and attaching one requires the invitation path so the person
 * consents rather than an administrator setting a password on an account that
 * is already somebody's. See `refuseAnAddressThatCannotJoin()`.
 */
class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Authorization proper is UserPolicy, applied in the controller.
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            // Not `unique`. An address that already has an account may be
            // joinable — see `refuseAnAddressThatCannotJoin()` — and a bare
            // uniqueness rule is what made a fleet unable to hire its own
            // driver applicant, saying only "the email has already been taken".
            'email' => ['required', 'email', 'max:255'],
            // Required here although the column is nullable: every account
            // made from this screen onwards has a number, because a booking
            // raised for this person is dispatched against it. The accounts
            // that predate the column keep their null until somebody edits
            // them — see the migration.
            'phone' => ['required', 'string', 'max:32'],
            // Any role slug that exists, system or custom (ADR-0004).
            'role' => ['required', 'string', Rule::exists('roles', 'slug')],
            // See UpdateUserRequest: a client's switches for a client's
            // people, under the same escalation rule as the role.
            'capabilities' => ['sometimes', 'array'],
            'capabilities.*' => ['string', Rule::enum(ClientCapability::class)],
            'books_without_approval' => ['sometimes', 'boolean'],
            // The routes this colleague rides (ADR-0045 §8). A roster, not
            // a permission — nothing authorises off it, so it needs no
            // escalation check of its own. That the routes are the actor's
            // own tenant's is enforced in `UserAdminService`, which is where
            // the sync happens and where a missed `where` would let one
            // client pin somebody to another's circuit.
            'route_ids' => ['sometimes', 'array', 'max:50'],
            'route_ids.*' => ['required', 'integer', Rule::exists('client_routes', 'id')],
            // Laravel's defaults plus a length floor. AGENTS.md leaves
            // hashing to the framework but says nothing about strength, so
            // this is the conservative reading rather than an invention.
            //
            // Required **unless** an invitation is being sent, in which case
            // the account is created with a random one nobody ever sees and
            // the new colleague sets their own from the emailed link.
            'password' => [
                Rule::requiredIf(fn () => ! $this->boolean('invite')),
                'string',
                PasswordPolicy::rule(),
            ],
            // Whether to email a link instead of setting a password here.
            // Both paths, by the owner's decision of 25 August: mail is a
            // platform setting that may be off, and an invitation-only
            // endpoint would then mean nobody can be added at all.
            'invite' => ['sometimes', 'boolean'],
            // Read only for a fleet-level actor — a client administrator's
            // colleagues are always their own client's, forced in
            // `UserAdminService`, and the field is not consulted for them.
            //
            // `exists` is not enough on its own and was the write half of the
            // ADR-0055 leak: any fleet could name any client on the platform
            // and plant an account inside it. The `servedBy` check is added in
            // `withValidator()`, where the actor is available.
            'tenant_id' => ['sometimes', 'integer', 'exists:tenants,id'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();
            $role = Role::query()->where('slug', $this->input('role'))->first();

            if ($actor === null || $role === null) {
                return;
            }

            $policy = app(UserPolicy::class);

            // Somebody who may not create accounts at all is not a
            // validation problem, and answering 422 here would mask the 403
            // the controller is about to give — telling a Dispatcher their
            // *role field* was wrong when the truth is they may not be on
            // this endpoint. Authorization answers first; this only speaks
            // for actors who got past it.
            if (! $policy->create($actor)) {
                return;
            }

            // The escalation check, as a 422 rather than a 403: the request
            // is well-formed and the actor may create users — it is this
            // particular role they may not grant.
            foreach ($this->input('capabilities', []) as $slug) {
                $capability = is_string($slug) ? ClientCapability::tryFrom($slug) : null;
                if ($capability !== null && ! $actor->holdsAll(array_map(fn ($p) => $p->value, $capability->permissions()))) {
                    $validator->errors()->add(
                        'capabilities',
                        'You cannot grant "'.$capability->label().'": it carries permissions you do not hold yourself.',
                    );
                    break;
                }
            }

            // The level the new account will hold, which decides which
            // audience of role it may be given. Naming a client makes them
            // that client's person; naming none makes them the actor's own
            // kind — the rule `UserAdminService::insert()` applies to the
            // columns, said here so the role is judged against the same
            // answer rather than against the actor's level.
            $subjectLevel = $this->filled('tenant_id')
                ? AccessLevel::CLIENT
                : $actor->access_level;

            if (! $policy->assignRole($actor, $role, $subjectLevel)) {
                $validator->errors()->add(
                    'role',
                    $role->audience === RoleAudience::forLevel($subjectLevel)
                        ? 'You cannot create an account with that role: it carries permissions you do not hold yourself.'
                        : 'That role is for a '.$role->audience->label().' account, not this one.',
                );
            }

            $this->refuseAnUnservedClient($validator, $actor);
            $this->refuseAnInvitationNothingCanSend($validator);
            $this->refuseAnAddressThatCannotJoin($validator, $actor);
        });
    }

    /**
     * An address that already has an account: joined, or refused by name.
     *
     * A driver application mints an account at submission time (ADR-0055,
     * amendment), so the person a fleet wants to hire on Tuesday may already
     * hold one from applying on Monday. `unique` turned that into *"the email
     * has already been taken"* — true, useless, and the same wall the fleet
     * handover hit the day before.
     *
     * Two conditions, and they answer different questions.
     *
     * **May this account be here at all** is `joinableReason()`: an applicant
     * or somebody already at this organisation, never another organisation's.
     *
     * **May this administrator do it without their consent** is the invitation.
     * Creating a fresh account with a typed password is fine — nobody owns it
     * yet. Folding in an account that already exists is not: an applicant's
     * account holds their own driver application, licence and ID, and a
     * password typed by a fleet office would be a way into it. The link goes
     * to the address, so the person is the one who decides.
     */
    private function refuseAnAddressThatCannotJoin(Validator $validator, User $actor): void
    {
        $existing = User::query()->where('email', (string) $this->input('email'))->first();

        if ($existing === null) {
            return;
        }

        $reason = app(UserAdminService::class)->joinableReason($existing, $actor);

        if ($reason !== null) {
            $validator->errors()->add('email', $reason);

            return;
        }

        if (! $this->boolean('invite')) {
            $validator->errors()->add(
                'email',
                'That address already has an account. Tick "Email them a link to set their own password" to add them — an existing password is theirs to keep.',
            );
        }
    }

    /**
     * An invitation the platform cannot deliver is refused, not queued.
     *
     * `mail.enabled` is a setting and it is off on production today. Creating
     * the account anyway would leave a colleague nobody can sign in as and
     * nobody was told about — the exact hole the invitations table was built
     * to close, reopened from the other end: *"a fleet owner and a corporate
     * client admin were accounts nobody could sign into, and every test in the
     * suite passed."*
     *
     * The console asks the server whether this is available (`meta.can_invite`)
     * and hides the option when it is not, so reaching this message means
     * somebody called the API directly or the setting changed mid-session.
     */
    private function refuseAnInvitationNothingCanSend(Validator $validator): void
    {
        if (! $this->boolean('invite')) {
            return;
        }

        if (! app(SettingsService::class)->mailConfigured()) {
            $validator->errors()->add(
                'invite',
                'Email is not switched on, so an invitation cannot be sent. Set an initial password instead.',
            );
        }
    }

    /**
     * A fleet may only place an account inside a client it actually serves.
     *
     * The write mirror of the read leak `User::scopeForActor()` closed on
     * 23 August. Without this, `tenant_id` is validated as *existing* and
     * nothing else — so any fleet could name any client on the platform and
     * create a working account inside it. That is worse than the read it
     * mirrors: a planted account is a standing credential in somebody else's
     * organisation, and it outlives the request that made it.
     *
     * `servedBy` is active contracts only. A fleet that has merely *asked* to
     * serve a client reaches nobody there — ADR-0060 §4 refuses the read on
     * the grounds that asking is free and needs nobody's consent, and the same
     * argument forbids the write.
     *
     * A 422 rather than a 403: the actor may create accounts, and it is this
     * particular client they may not create one in. Head office does not reach
     * here — `UserAdminService` refuses a Kangaru actor a client outright — and
     * a client administrator never has this field read at all.
     */
    private function refuseAnUnservedClient(Validator $validator, User $actor): void
    {
        $tenantId = $this->input('tenant_id');

        if ($tenantId === null) {
            return;
        }

        // Head office employs head office (ADR-0065), so the field means
        // nothing here. Refused rather than ignored: `UserAdminService` would
        // drop it and return 201, and an administrator who named a client and
        // got a head-office account back has been told the opposite of what
        // happened.
        if ($actor->access_level === AccessLevel::KANGARU) {
            $validator->errors()->add(
                'tenant_id',
                'A Kangaru account belongs to no client. To add somebody at a fleet or a client, log in as them.',
            );

            return;
        }

        if (! $actor->isPlatformLevel()) {
            return;
        }

        $serves = OperatorClient::query()
            ->servedBy((int) $actor->operator_id)
            ->where('tenant_id', (int) $tenantId)
            ->exists();

        if (! $serves) {
            $validator->errors()->add(
                'tenant_id',
                'You can only add staff to a client your fleet serves.',
            );
        }
    }
}
