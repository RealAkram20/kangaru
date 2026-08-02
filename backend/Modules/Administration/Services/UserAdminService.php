<?php

namespace Modules\Administration\Services;

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Creating and editing accounts.
 *
 * A service rather than Eloquent in the controller, because two of these
 * carry rules the model cannot express: which tenant a new account lands
 * in, and the fact that suspending must stamp a clock AGENTS.md's
 * retention policy will later count from.
 *
 * `User` is `Auditable`, so every write here produces an audit_logs row
 * with the before/after diff — AGENTS.md requires exactly that for
 * "roles/permissions" changes, and it is the reason role edits go through
 * a save rather than a mass update.
 */
class UserAdminService
{
    /**
     * @param  array<string, mixed>  $attributes  already validated
     */
    public function create(array $attributes, User $actor): User
    {
        return User::create([
            'name' => $attributes['name'],
            'email' => $attributes['email'],
            'password' => $attributes['password'],
            'role' => $attributes['role'],
            'status' => UserStatus::ACTIVE,
            // A tenant administrator's new colleagues are always their own
            // tenant's, whatever the request said — the field is not even
            // read for them. Only a platform-level account, which has no
            // tenant of its own, chooses.
            'tenant_id' => $actor->tenant_id === null
                ? ($attributes['tenant_id'] ?? null)
                : $actor->tenant_id,
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes  already validated
     */
    public function update(User $subject, array $attributes): User
    {
        return DB::transaction(function () use ($subject, $attributes) {
            $subject->fill(array_intersect_key($attributes, array_flip(['name', 'email', 'role'])));

            if (array_key_exists('status', $attributes)) {
                $status = $attributes['status'] instanceof UserStatus
                    ? $attributes['status']
                    : UserStatus::from((string) $attributes['status']);

                $subject->status = $status;

                // Stamped on the way down and cleared on the way back up.
                // AGENTS.md wants ex-employee accounts anonymised 90 days
                // after deactivation; a reactivated account is not an
                // ex-employee, and leaving the old timestamp would queue
                // them for anonymisation while they are still working.
                $subject->deactivated_at = $status === UserStatus::SUSPENDED ? now() : null;
            }

            $subject->save();

            return $subject;
        });
    }

    /**
     * Revokes every API token the account holds.
     *
     * Suspension that only blocks the login form is not suspension: a
     * Sanctum token issued yesterday keeps working until it expires, so a
     * dismissed employee stays signed in on their phone. Called when an
     * account is suspended, and deliberately not on reactivation — tokens
     * are not restored, the person signs in again.
     */
    public function revokeTokens(User $subject): void
    {
        $subject->tokens()->delete();
    }
}
