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

/**
 * Onboarding a colleague.
 *
 * The administrator sets an initial password rather than the platform
 * emailing an invitation link. An invite flow needs a signed, expiring
 * token and a public accept-invite page, neither of which exists — and a
 * half-built invite that emails a link to nowhere is worse than an honest
 * "tell them this password and have them change it". The change-password
 * endpoint that completes the loop ships alongside this.
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
            // Unique across the platform, not per tenant: the login form
            // asks for an email and nothing else, so two tenants sharing an
            // address would make authentication ambiguous. The database
            // already enforces it; this turns a 500 into a 422.
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
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
            'password' => ['required', 'string', PasswordPolicy::rule()],
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
        });
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
