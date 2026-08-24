<?php

namespace Modules\Administration\Requests;

use App\Enums\ClientCapability;
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
            // Super Admin only — a Corporate Admin's users are always their
            // own tenant's, forced in the controller.
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

            if (! $policy->assignRole($actor, $role)) {
                $validator->errors()->add(
                    'role',
                    'You cannot create an account with that role: it carries permissions you do not hold yourself.',
                );
            }
        });
    }
}
