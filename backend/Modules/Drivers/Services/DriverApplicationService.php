<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Vehicles\Models\Vehicle;

/**
 * Turning an application into a driver, or ending it (ADR-0027).
 *
 * The whole point of this class is that approval is **one act**. A driver
 * profile with no account cannot work a trip, and an account with no profile
 * is a login `TripPolicy` refuses on every request; both are states an
 * administrator who closed their laptop halfway through would otherwise
 * leave behind.
 */
class DriverApplicationService
{
    /**
     * How long an applicant has to send their papers (ADR-0048 §4).
     *
     * A day. Long enough to walk home, find the logbook and photograph it in
     * daylight; short enough that a ticket copied out of a phone's network log
     * is dead before anybody would think to use it. An applicant who misses it
     * is not stuck — the office reaches them by phone (ADR-0027 §6) and the
     * documents can be uploaded from the driver app once they are approved,
     * which is the route ADR-0033 built and this one only supplements.
     */
    public const UPLOAD_WINDOW_HOURS = 24;

    public function __construct(
        private readonly DriverAccountService $accounts,
        private readonly ReferralService $referrals,
        private readonly DriverDocumentService $documents,
    ) {}

    /**
     * Mints a claim ticket for an application, returning the plaintext.
     *
     * Returned to the caller **once**, in the submission response, and never
     * recoverable afterwards: the column holds a SHA-256 of it. There is no
     * "resend my token" endpoint and there should not be — that endpoint would
     * take an email address and say whether an application exists for it,
     * which is precisely the oracle ADR-0027 §5 refuses.
     *
     * `Str::random(64)` draws from a CSPRNG. It is not the application id, is
     * not derived from it, and cannot be walked to a neighbouring row.
     */
    private function mintUploadToken(DriverApplication $application): string
    {
        $plain = Str::random(64);

        $application->forceFill([
            'upload_token_hash' => hash('sha256', $plain),
            'upload_token_expires_at' => now()->addHours(self::UPLOAD_WINDOW_HOURS),
        ])->save();

        return $plain;
    }

    /**
     * Finds the application a claim ticket belongs to, or null (ADR-0048 §4).
     *
     * **Null for unknown, expired and already-decided alike**, and the caller
     * answers 404 for all three. Distinguishing them would tell an
     * unauthenticated holder of a wrong token whether a right one exists, and
     * "this application was rejected" is not a thing to learn from an HTTP
     * status.
     *
     * The lookup is by hash and hits the unique index, so it is one indexed
     * read and not a scan-and-compare over every application.
     */
    public function findByUploadToken(?string $plain): ?DriverApplication
    {
        if ($plain === null || $plain === '') {
            return null;
        }

        $application = DriverApplication::query()
            ->where('upload_token_hash', hash('sha256', $plain))
            ->first();

        if ($application === null || ! $application->acceptsUploads()) {
            return null;
        }

        return $application->status->isOpen() ? $application : null;
    }

    /**
     * Records an application. Called by an unauthenticated stranger.
     *
     * @param  array<string, mixed>  $attributes  already validated
     */
    public function submit(array $attributes): DriverApplication
    {
        $application = DriverApplication::create([
            'name' => $attributes['name'],
            'phone' => $attributes['phone'],
            'email' => $attributes['email'],
            // Hashed here, at the edge of the system, so the plaintext never
            // reaches a second line of code.
            'password' => bcrypt($attributes['password']),
            'status' => DriverApplicationStatus::PENDING,
            // Stored exactly as typed, and **deliberately not checked here**
            // (ADR-0037 §5). Resolving it at submission would answer "is this
            // one of your drivers' codes?" to an unauthenticated stranger, one
            // guess at a time — the same leak ADR-0027 §5 refuses for the email
            // address. It is resolved at approval, in front of a human.
            'referral_code' => $attributes['referral_code'] ?? null,
            // The server's clock, never the client's: a consent timestamp a
            // phone could set is not evidence of anything.
            'terms_accepted_at' => now(),
        ]);

        // Minted in a second write rather than in the `create()` above, so
        // that the plaintext is produced by exactly one method and the row is
        // never constructed with a half-set ticket.
        $application->setAttribute('upload_token', $this->mintUploadToken($application));

        return $application;
    }

    /**
     * Creates the driver, mints their account, links the two, and closes the
     * application — all or nothing.
     *
     * @param  array<string, mixed>  $attributes  already validated
     *
     * @throws DriverApplicationClosedException somebody decided this already
     * @throws DriverAccountConflictException the email is taken
     */
    public function approve(
        DriverApplication $application,
        User $reviewer,
        array $attributes,
    ): Driver {
        return DB::transaction(function () use ($application, $reviewer, $attributes) {
            // Locked, not merely re-read. Two reviewers working the same
            // queue would both pass a plain status check and the platform
            // would mint two accounts for one person — the second failing
            // on the email unique index, but only after the first had
            // already created a driver profile.
            $locked = DriverApplication::query()
                ->whereKey($application->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            if (! $locked->status->isOpen()) {
                throw DriverApplicationClosedException::alreadyDecided($locked);
            }

            // The duplicate ADR-0027 §5 deliberately accepted at submission
            // is refused here, in front of a human. Checked in the service
            // rather than left to the users_email_unique index, because
            // ADR-0016's own path catches this in its form request — a rule
            // this path does not pass through — and an integrity violation
            // mid-transaction tells the reviewer nothing about what to do.
            if (User::query()->where('email', $locked->email)->exists()) {
                throw DriverAccountConflictException::emailAlreadyHasAccount($locked->email);
            }

            /**
             * The vehicle the applicant rode in on (ADR-0048 §8).
             *
             * Registered inside the approval transaction, so a reviewer who
             * abandons this halfway leaves nothing behind — the same
             * all-or-nothing ADR-0027 §4 already demanded of the driver, the
             * account and the link.
             *
             * `vehicles.manage` is checked separately from the approval
             * permissions (ADR-0048 §9): approving an application is
             * `drivers.manage` + `staff.manage`, and neither of those is a
             * grant over the fleet.
             */
            $vehicleId = $attributes['vehicle_id'] ?? null;

            if (isset($attributes['vehicle']) && is_array($attributes['vehicle'])) {
                if (Gate::forUser($reviewer)->denies('create', Vehicle::class)) {
                    throw new AuthorizationException(
                        'Registering a vehicle needs the fleet permission. '
                        .'Approve them without one and add it from the fleet screen.'
                    );
                }

                $vehicleId = Vehicle::create($attributes['vehicle'])->getKey();
            }

            $driver = Driver::create([
                'name' => $locked->name,
                'phone' => $locked->phone,
                'email' => $locked->email,
                'license_number' => $attributes['license_number'],
                'license_expiry' => $attributes['license_expiry'],
                'vehicle_id' => $vehicleId,
                'owns_vehicle' => (bool) ($attributes['owns_vehicle'] ?? false),
                'status' => 'active',
            ]);

            // ADR-0016's endpoint, unchanged and unbypassed: the link is
            // still made by the one service allowed to make it, under the
            // same permissions, with the same exclusivity guarantees.
            //
            // The password travels as the hash the applicant's own choice
            // produced. `User`'s `hashed` cast recognises it and passes it
            // through, so it is never hashed twice and never re-typed.
            $this->accounts->open($driver, [
                'name' => $locked->name,
                'email' => $locked->email,
                'password' => $locked->password,
                'role' => $attributes['role'] ?? 'driver',
            ]);

            // ADR-0037 §5. Inside the same transaction, so a referral and the
            // driver it concerns are written together or not at all.
            //
            // **It cannot fail the approval.** A code that resolves to nobody,
            // a person somebody has already introduced, or the scheme being
            // switched off all return null and are ignored: the reviewer is
            // giving somebody a job, and a mistyped code is not a reason to
            // refuse them one.
            $this->referrals->attach($driver, $locked->referral_code);

            /**
             * The papers the applicant sent become the driver's
             * (ADR-0048 §5).
             *
             * Inside the same transaction as everything else, because a
             * driver created without their documents is the half-finished
             * state ADR-0027 §4 exists to prevent, in a new place.
             *
             * **Their `pending` status is not touched.** Approval is not
             * review — nobody has looked at these files, and verifying them
             * because a different decision went the applicant's way is
             * ADR-0033 §4's auto-verification arriving through a side door.
             */
            $this->documents->carryToDriver($locked, $driver);

            $locked->forceFill([
                'status' => DriverApplicationStatus::APPROVED,
                'reviewed_by_user_id' => $reviewer->getKey(),
                'reviewed_at' => now(),
                'driver_id' => $driver->getKey(),
                // The live copy is on `users` now. Keeping a second one here
                // would mean a stranger's working credential sitting in a
                // table nobody thinks of as sensitive.
                'password' => null,
                // The ticket is spent (ADR-0048 §4). An applicant cannot
                // amend an application somebody has already decided, and the
                // driver app's own upload route is theirs from now on.
                'upload_token_hash' => null,
                'upload_token_expires_at' => null,
            ])->save();

            return $driver;
        });
    }

    /**
     * Ends an application, with a reason for the office.
     *
     * @throws DriverApplicationClosedException
     */
    public function reject(
        DriverApplication $application,
        User $reviewer,
        string $reason,
    ): DriverApplication {
        return DB::transaction(function () use ($application, $reviewer, $reason) {
            $locked = DriverApplication::query()
                ->whereKey($application->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            if (! $locked->status->isOpen()) {
                throw DriverApplicationClosedException::alreadyDecided($locked);
            }

            /**
             * The files go with the decision (ADR-0048 §5).
             *
             * The same reasoning that clears the password one line below, and
             * the stronger case for it: a photograph of a stranger's face and
             * national ID, held against somebody the platform decided
             * against, is a liability with no corresponding use. The
             * `Auditable` trail records that it happened.
             */
            $this->documents->discardFor($locked);

            $locked->forceFill([
                'status' => DriverApplicationStatus::REJECTED,
                'reviewed_by_user_id' => $reviewer->getKey(),
                'reviewed_at' => now(),
                'rejection_reason' => $reason,
                // Nobody should be holding a rejected stranger's credential.
                'password' => null,
                'upload_token_hash' => null,
                'upload_token_expires_at' => null,
            ])->save();

            return $locked;
        });
    }
}
