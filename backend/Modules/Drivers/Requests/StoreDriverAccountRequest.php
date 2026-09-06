<?php

namespace Modules\Drivers\Requests;

use App\Models\User;
use App\Support\Auth\PasswordPolicy;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Models\Role;
use Modules\Administration\Policies\UserPolicy;
use Modules\Drivers\Services\DriverAccountService;

/**
 * Attaching a login to a driver profile (ADR-0016).
 *
 * Two shapes, one endpoint:
 *
 * - `{email, password, role?, name?}` — mint a new account.
 * - `{user_id}` — adopt an account that already exists, which is the only
 *   route back for drivers whose accounts were created by hand before this
 *   endpoint did. Without it those rows are unreachable and the fix is a
 *   database console.
 *
 * They are mutually exclusive rather than merged, because a request
 * carrying both would have to pick, and picking silently is how an
 * administrator ends up creating a second account for somebody who already
 * had one.
 *
 * As with `StoreUserRequest`, the initial password is set by the
 * administrator rather than emailed as an invite link: there is no
 * accept-invite page, and a half-built invite that mails a link to nowhere
 * is worse than an honest "tell them this and have them change it".
 */
class StoreDriverAccountRequest extends FormRequest
{
    public function authorize(): bool
    {
        // DriverPolicy::manageAccount, applied in the controller.
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $adopting = $this->has('user_id');

        return [
            'user_id' => [
                'sometimes',
                'integer',
                Rule::exists('users', 'id'),
                Rule::prohibitedIf(fn () => $this->hasAny(['email', 'password'])),
            ],
            // Same platform-wide uniqueness as StoreUserRequest, and for
            // the same reason: the login form asks for an email and nothing
            // else, so two accounts sharing one would make authentication
            // ambiguous.
            'email' => [
                Rule::requiredIf(! $adopting),
                'email',
                'max:255',
                Rule::unique('users', 'email'),
            ],
            'password' => [Rule::requiredIf(! $adopting), 'string', PasswordPolicy::rule()],
            // Defaults to the seeded `driver` role. Named as a field rather
            // than hardcoded so ADR-0004's custom roles are reachable — a
            // "Relief Driver" carrying the same transition permission is a
            // legitimate answer.
            'role' => ['sometimes', 'string', Rule::exists('roles', 'slug')],
            'name' => ['sometimes', 'string', 'max:255'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function validated($key = null, $default = null): array
    {
        $validated = parent::validated();

        if (! array_key_exists('user_id', $validated)) {
            $validated['role'] ??= 'driver';
        }

        return $validated;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();

            if ($actor === null || $validator->errors()->isNotEmpty()) {
                return;
            }

            $this->refuseRolesTheActorDoesNotHold($validator, $actor);
            $this->refuseAccountsThatCannotDrive($validator);
        });
    }

    /**
     * ADR-0004's escalation rule, as a 422 rather than a 403: the actor may
     * be on this endpoint and still not be allowed to hand out *this* role.
     *
     * Without it, `drivers.manage` would become a quiet route to minting
     * accounts in any role at all — which is the whole reason this is not a
     * field on the driver form.
     */
    private function refuseRolesTheActorDoesNotHold(Validator $validator, User $actor): void
    {
        if ($this->has('user_id')) {
            return;
        }

        // Somebody who may not create accounts at all is not a validation
        // problem, and answering 422 here would mask the 403 the controller
        // is about to give — telling a Depot Manager their *role field* was
        // wrong when the truth is they may not be on this endpoint. Form
        // requests run before `authorize()`, so this ordering is ours to
        // get right. Same guard, same reason, as StoreUserRequest.
        if (! app(UserPolicy::class)->create($actor)) {
            return;
        }

        $slug = (string) ($this->input('role') ?? 'driver');
        $role = Role::query()->where('slug', $slug)->first();

        if (app(UserPolicy::class)->assignRole($actor, $role)) {
            return;
        }

        $validator->errors()->add(
            'role',
            'You cannot create an account in that role: it carries permissions you do not hold yourself.',
        );
    }

    /**
     * An account that cannot transition its own trips is a login that does
     * nothing — it would attach cleanly and then be refused by `TripPolicy`
     * on every status update the driver tried to record.
     */
    private function refuseAccountsThatCannotDrive(Validator $validator): void
    {
        if (! $this->has('user_id')) {
            return;
        }

        /** @var User|null $account */
        $account = User::query()->whereKey($this->input('user_id'))->first();

        if ($account === null || app(DriverAccountService::class)->canDrive($account)) {
            return;
        }

        $validator->errors()->add(
            'user_id',
            'That account is not in a role that may drive, so linking it would create a sign-in that '.
            'cannot record a single trip. Give it a driving role first, or create a new account here.',
        );
    }
}
