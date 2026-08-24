<?php

namespace Modules\Administration\Services;

use App\Enums\AccessLevel;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Modules\Clients\Models\ClientRoute;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Notifications\SecurityEventNotification;

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
        return DB::transaction(function () use ($attributes, $actor) {
            $user = $this->insert($attributes, $actor);

            if (array_key_exists('route_ids', $attributes)) {
                $this->replaceRoutes($user, $attributes['route_ids'], $actor);
            }

            return $user;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes  already validated
     */
    private function insert(array $attributes, User $actor): User
    {
        // Head office employs head office (ADR-0065). A Kangaru actor names
        // no fleet and no client, and the account they create names neither
        // either — which is the one column shape that cannot be derived, and
        // is therefore declared below rather than inferred.
        $kangaru = $actor->access_level === AccessLevel::KANGARU;

        $tenantId = match (true) {
            $kangaru => null,
            $actor->isPlatformLevel() => $attributes['tenant_id'] ?? null,
            default => $actor->tenant_id,
        };

        $user = new User([
            'name' => $attributes['name'],
            'email' => $attributes['email'],
            'phone' => $attributes['phone'] ?? null,
            'password' => $attributes['password'],
            'role' => $attributes['role'],
            'capabilities' => $attributes['capabilities'] ?? null,
            'books_without_approval' => (bool) ($attributes['books_without_approval'] ?? false),
            'status' => UserStatus::ACTIVE,
            // A tenant administrator's new colleagues are always their own
            // tenant's, whatever the request said — the field is not even
            // read for them. Only a platform-level account, which has no
            // tenant of its own, chooses; and it may choose null, which
            // since ADR-0006 is a deliberate act rather than a fallback.
            // That creates Shanitah staff who read across every client, so
            // it is Super Admin's to do — `staff.manage` is the gate, and
            // the escalation rule (ADR-0004) is what keeps a Corporate
            // Admin from reaching it.
            'tenant_id' => $tenantId,
            // The mirror of the line above, and it has to be said rather than
            // left out (ADR-0055 §4). A new colleague with neither a client nor
            // a fleet is **Kangaru** — head office — and `User::saving` refuses
            // to infer that. The suite found this the moment the guard landed:
            // 36 failures, every one of them this line missing.
            //
            // A colleague pinned to a client is that client's and has no fleet.
            // Everyone else joins whichever fleet the administrator making the
            // appointment belongs to — and a Kangaru actor has none to pass on,
            // which is the case handled immediately below.
            'operator_id' => $kangaru ? null : ($tenantId === null ? $actor->operator_id : null),
        ]);

        /*
         * The one level that cannot be derived, said out loud by somebody who
         * meant it (ADR-0055 §4).
         *
         * This used to throw. Two nulls are Kangaru, `User::levelFor()` refuses
         * to guess that, and the comment here said the proper path "arrives
         * with S1" — which shipped `php artisan kangaru:create-staff` and left
         * the endpoint erroring, so the Kangaru staff screen could list people
         * and never add one.
         *
         * It is assigned rather than sent: `access_level` is deliberately
         * absent from `User::$fillable`, so head office cannot be reached by a
         * request payload naming it. The only way to this line is to already
         * be head office, which is what makes it the "serious act" ADR-0006
         * describes.
         *
         * The console command stays. It is the way in when there is no way in.
         */
        if ($kangaru) {
            $user->access_level = AccessLevel::KANGARU;
        }

        $user->save();

        return $user;
    }

    /**
     * @param  array<string, mixed>  $attributes  already validated
     * @param  User  $actor  the administrator making the change — the routes
     *                       they may pin are scoped to them (ADR-0006)
     */
    public function update(User $subject, array $attributes, User $actor): User
    {
        // Captured before `fill()`, because after it the old value is gone and
        // the whole point of the address warning is that it reaches the
        // address the account **used to** have.
        $addressBefore = (string) $subject->email;
        $statusBefore = $subject->status;

        $updated = DB::transaction(function () use ($subject, $attributes, $actor) {
            $subject->fill(array_intersect_key(
                $attributes,
                array_flip(['name', 'email', 'phone', 'role', 'capabilities', 'books_without_approval']),
            ));

            if (array_key_exists('route_ids', $attributes)) {
                $this->replaceRoutes($subject, $attributes['route_ids'], $actor);
            }

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

        $this->announceSecurityChanges($updated, $addressBefore, $statusBefore);

        return $updated;
    }

    /**
     * The three changes here that the account holder has to hear about.
     *
     * Outside the transaction on purpose. These are notifications about
     * something that has already happened and been committed; raising one
     * inside would mean a mail failure could roll back a suspension somebody
     * decided on, which inverts which of the two matters.
     */
    private function announceSecurityChanges(User $subject, string $addressBefore, ?UserStatus $statusBefore): void
    {
        if ($subject->status !== $statusBefore) {
            $subject->notify(new SecurityEventNotification(
                $subject->status === UserStatus::SUSPENDED
                    ? NotificationType::ACCOUNT_SUSPENDED
                    : NotificationType::ACCOUNT_REACTIVATED,
                [__('mail.security.fact_when') => now()->isoFormat('D MMMM YYYY, HH:mm')],
            ));
        }

        $addressAfter = (string) $subject->email;

        if ($addressAfter === $addressBefore || $addressBefore === '') {
            return;
        }

        $facts = [__('mail.security.fact_when') => now()->isoFormat('D MMMM YYYY, HH:mm')];

        // Sent twice, and the second copy is the one that matters.
        //
        // Somebody who has taken an account and changed its address has
        // redirected every future warning to themselves. The copy addressed to
        // the **old** mailbox is the last message the real owner will ever
        // receive about this account, so it is not optional and it is not a
        // nicety. The new address gets one too, because the legitimate case
        // deserves a confirmation where it will actually be read.
        $subject->notify(new SecurityEventNotification(NotificationType::ACCOUNT_EMAIL_CHANGED, $facts));
        $subject->notify(new SecurityEventNotification(
            NotificationType::ACCOUNT_EMAIL_CHANGED,
            $facts,
            $addressBefore,
        ));
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

    /**
     * Sets which of the client's routes this person rides (ADR-0045 §8).
     *
     * A roster, not a permission — nothing authorises off `client_route_members`
     * — so there is no escalation rule to apply here. What there *is* is an
     * isolation rule, and it is the whole of this method: a route may only
     * be pinned to somebody in the tenant that owns it. `User` carries no
     * global tenant scope (see the model), and `ClientRoute`'s scope follows
     * the *actor's* tenant rather than the subject's, so the `where` is
     * written out by hand here and asserted directly.
     *
     * Refused rather than filtered, like `ClientRouteService::replaceMembers`:
     * a roster that saves as two routes when three were named is a lie
     * noticed a month later by a driver waiting at an ATM.
     *
     * @param  array<int, int>  $routeIds
     *
     * @throws ValidationException
     */
    private function replaceRoutes(User $subject, array $routeIds, User $actor): void
    {
        $wanted = array_values(array_unique(array_map('intval', $routeIds)));

        if ($wanted === []) {
            $subject->clientRoutes()->sync([]);

            return;
        }

        // A platform account has no tenant and therefore no routes to ride.
        // Refused by name, because the alternative is a `where(..., null)`
        // that matches nothing and reports it as "not yours".
        if ($subject->tenant_id === null) {
            throw ValidationException::withMessages([
                'route_ids' => "Routes belong to a client's own staff, not to platform accounts.",
            ]);
        }

        // Both halves, and they answer different questions. `forActor` is
        // ADR-0006's named way past the tenant scope, and it is what lets a
        // Super Admin — who has no tenant of their own — administer a
        // client's staff at all. The explicit `where` is what stops that
        // same dropped scope from pinning one client's route to another
        // client's employee.
        $owned = ClientRoute::query()
            ->forActor($actor)
            ->whereIn('id', $wanted)
            ->where('tenant_id', $subject->tenant_id)
            ->pluck('id')
            ->all();

        if (count($owned) !== count($wanted)) {
            throw ValidationException::withMessages([
                'route_ids' => 'One of those routes is not yours.',
            ]);
        }

        // The pivot carries `tenant_id` (ADR-0001 covers join tables too)
        // and `sync()` will not invent it — a bare sync fails on the NOT
        // NULL column.
        $subject->clientRoutes()->sync(
            array_fill_keys($owned, ['tenant_id' => $subject->tenant_id]),
        );
    }
}
