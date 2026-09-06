<?php

namespace Modules\Fleet\Services;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Modules\Administration\Services\InvitationService;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\OfficeRecipient;
use Modules\Notifications\Notifications\OfficeEventNotification;

/**
 * Onboarding a fleet company (ADR-0055, ADR-0059 §5).
 *
 * This is the package that removes the rail. Until now `Operator` carried a
 * docblock saying *"There is deliberately no way to create a second one"* —
 * no endpoint, no policy, no factory, no seeder — because between `F0` and
 * `F2` the operational tables carried `operator_id` and nothing filtered on
 * it, so a second fleet's dispatcher would have read Shanitah's trips. `F2`
 * closed that and `K0` proved it on MySQL, so the rail comes down here.
 *
 * One thing is still true and should be carried rather than discovered:
 * **trip children are not independently fleet-scoped.** `trip_events`,
 * `trip_locations` and `trip_stops` are reached through a trip, and the trip
 * is the gate. That is sound today because there is no route to them that
 * does not resolve a trip first. It stops being sound the moment somebody
 * adds one.
 */
class OperatorService
{
    /**
     * Create a fleet and its first account, together or not at all.
     *
     * ## Why the account is not optional
     *
     * ADR-0056 assumes **a person's identity**. There is no "act as
     * Shanitah"; there is "act as Shanitah's fleet owner". A fleet with no
     * accounts is therefore permanently unreachable to the people whose job
     * is to support it — and it fails at the worst possible moment, because
     * "the last administrator left" and "we need support" are correlated
     * events.
     *
     * So the owner account is created in the same transaction, and ADR-0059
     * §5 forbids the count ever reaching zero afterwards. A fleet that exists
     * with nobody in it is not a lesser version of this feature; it is the
     * failure mode.
     *
     * @param  array{name: string, slug?: string|null, owner_name: string, owner_email: string, plan_id?: int|null}  $input
     */
    public function onboard(array $input, ?User $invitedBy = null): Operator
    {
        // The plan may be chosen at onboarding (owner's ask, 24 August).
        // When it is not, `Operator::booted()` assigns the default and
        // throws when none is flagged (ADR-0058 §1) — on the model rather
        // than here, so a seeder or a fixture cannot make an unpriced fleet
        // by taking a different path.
        return DB::transaction(function () use ($input, $invitedBy): Operator {
            $operator = Operator::create(array_filter([
                'name' => $input['name'],
                'slug' => $this->slugFor($input['name'], $input['slug'] ?? null),
                'status' => 'active',
                'plan_id' => $input['plan_id'] ?? null,
            ], fn (mixed $value) => $value !== null));

            // `access_level` is declared, never inferred (ADR-0055 §4), and
            // the database trigger refuses the row if it disagrees with the
            // two columns. A fleet account names its fleet and no client.
            $owner = User::create([
                'name' => $input['owner_name'],
                'email' => $input['owner_email'],
                // No password. The account is reached by the invitation the
                // console sends, so nothing here mints a credential that a
                // person did not choose — the same line `Modules/Customers`
                // and `AuthController::changePassword` both draw.
                'password' => Str::password(32),
                'role' => UserRole::FLEET_OWNER,
                'status' => UserStatus::ACTIVE,
                'tenant_id' => null,
                'operator_id' => $operator->id,
                'access_level' => AccessLevel::FLEET,
            ]);

            /*
             * The invitation, inside the same transaction.
             *
             * This line is what the comment above it promised for the whole
             * life of this method and did not deliver. `Str::password(32)` was
             * generated and thrown away, no invitation was sent, and the
             * result was a fleet owner who **could not sign in at all**: the
             * forgot-password route was closed twice over, by a disabled flag
             * and by an unconfigured mailer.
             *
             * In the transaction rather than after it, for the same reason the
             * account is: a fleet that exists with an owner nobody can reach
             * is the failure mode this method's own docblock names, and it
             * should not be reachable by a partial success either. The mail
             * itself is queued, so nothing here waits on a network.
             */
            app(InvitationService::class)->invite($owner, $invitedBy);

            /*
             * Head office hears about it (mail plan H1).
             *
             * `fleets.view`, not `fleets.manage`: whoever reads the register
             * is who wants to know a fleet joined, and narrowing to whoever
             * can edit it would leave an operations manager watching the
             * platform uninformed about its own growth.
             *
             * Never to another fleet. `OfficeRecipient::headOffice()` is the
             * only path here, and it filters on `access_level` rather than on
             * a permission every Super Admin happens to hold.
             */
            foreach (app(OfficeRecipient::class)->headOffice(Permission::FLEETS_VIEW) as $staff) {
                $staff->notify(new OfficeEventNotification(
                    NotificationType::PLATFORM_FLEET_ONBOARDED,
                    facts: [__('mail.office.fact_fleet') => (string) $operator->name],
                    url: '/fleets/'.$operator->getKey(),
                    replacements: ['fleet' => (string) $operator->name],
                ));
            }

            return $operator;
        });
    }

    /**
     * Suspending, and the one thing it deliberately does not do.
     *
     * A suspended fleet stops being offered work. Its trips, invoices and
     * drivers are untouched: they are what makes the past explicable, and a
     * suspension that erased them would trade a commercial decision for an
     * accounting hole. Deleting is not offered at all — see `OperatorPolicy`.
     */
    public function setStatus(Operator $operator, string $status): Operator
    {
        $operator->update(['status' => $status]);

        return $operator->refresh();
    }

    /**
     * A slug is how a fleet is named in a URL and in an invoice series, so it
     * is generated from the name unless one is given, and it is unique by the
     * column rather than by a check here — two simultaneous onboardings of
     * the same name is a race a `SELECT` cannot win.
     */
    private function slugFor(string $name, ?string $given): string
    {
        return Str::slug($given !== null && $given !== '' ? $given : $name);
    }
}
