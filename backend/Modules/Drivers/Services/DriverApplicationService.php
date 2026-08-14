<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;

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
    public function __construct(private readonly DriverAccountService $accounts) {}

    /**
     * Records an application. Called by an unauthenticated stranger.
     *
     * @param  array<string, mixed>  $attributes  already validated
     */
    public function submit(array $attributes): DriverApplication
    {
        return DriverApplication::create([
            'name' => $attributes['name'],
            'phone' => $attributes['phone'],
            'email' => $attributes['email'],
            // Hashed here, at the edge of the system, so the plaintext never
            // reaches a second line of code.
            'password' => bcrypt($attributes['password']),
            'status' => DriverApplicationStatus::PENDING,
            // The server's clock, never the client's: a consent timestamp a
            // phone could set is not evidence of anything.
            'terms_accepted_at' => now(),
        ]);
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

            $driver = Driver::create([
                'name' => $locked->name,
                'phone' => $locked->phone,
                'email' => $locked->email,
                'license_number' => $attributes['license_number'],
                'license_expiry' => $attributes['license_expiry'],
                'vehicle_id' => $attributes['vehicle_id'] ?? null,
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

            $locked->forceFill([
                'status' => DriverApplicationStatus::APPROVED,
                'reviewed_by_user_id' => $reviewer->getKey(),
                'reviewed_at' => now(),
                'driver_id' => $driver->getKey(),
                // The live copy is on `users` now. Keeping a second one here
                // would mean a stranger's working credential sitting in a
                // table nobody thinks of as sensitive.
                'password' => null,
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

            $locked->forceFill([
                'status' => DriverApplicationStatus::REJECTED,
                'reviewed_by_user_id' => $reviewer->getKey(),
                'reviewed_at' => now(),
                'rejection_reason' => $reason,
                // Nobody should be holding a rejected stranger's credential.
                'password' => null,
            ])->save();

            return $locked;
        });
    }
}
