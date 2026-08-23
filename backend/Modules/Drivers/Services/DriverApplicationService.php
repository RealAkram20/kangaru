<?php

namespace Modules\Drivers\Services;

use App\Enums\AccessLevel;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Notifications\DriverEventNotification;
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
    /**
     * A fresh claim ticket, so a refused document can be answered
     * (ADR-0057 §3).
     *
     * **Mints rather than extends, and the old one stops working.**
     * `mintUploadToken` overwrites the hash, so whatever the applicant held
     * before is dead the moment this runs. That is the property worth having:
     * a ticket emailed today does not sit alongside three older ones from
     * three earlier refusals, each still able to reach the same documents.
     *
     * Public where the minting is private, because only one caller outside
     * submission may cause a ticket to exist and it is a reviewer refusing a
     * document. Nothing unauthenticated reaches this.
     */
    public function reissueUploadToken(DriverApplication $application): string
    {
        return $this->mintUploadToken($application);
    }

    /**
     * The documents standing between an application and approval
     * (ADR-0057 §2).
     *
     * Returns the type labels of everything the office has **looked at and
     * not accepted** — `pending` because nobody has decided, `rejected`
     * because somebody did.
     *
     * **A slot with no document is not in this list.** Every document is
     * optional at submission (ADR-0048 §6) and the KYC screen says so in as
     * many words; a rule that demanded all six would make them mandatory
     * through the back door and contradict the screen. The same line
     * `complianceFor()` draws between `action_needed` and `incomplete`.
     *
     * @return list<string>
     */
    public function documentsBlockingApproval(DriverApplication $application): array
    {
        $blocking = [];

        foreach ($this->documents->forApplication($application) as $slot) {
            $document = $slot['document'];

            if ($document === null) {
                continue;
            }

            if ($document->status !== DriverDocumentStatus::VERIFIED) {
                $blocking[] = $slot['type']->label();
            }
        }

        return $blocking;
    }

    /**
     * The applicant's sign-in, created when they apply rather than when they
     * are approved (ADR-0057 §5).
     *
     * ## This is not the "pending user" ADR-0027 §1 refused
     *
     * §1 rejected a third `UserStatus`, because *"the cost of missing one is
     * a login that works before anybody approved it"*. There is no third
     * status here: the account is plainly `active`, and it is **inert**.
     * Every driver-facing controller resolves the actor with
     * `Driver::where('user_id', ...)` and answers "not a driver" on null, and
     * nothing in the platform grants anything for holding the role alone.
     * Approval creates the *link*, and the link is what grants — ADR-0016 §2,
     * untouched.
     *
     * ## `AccessLevel::APPLICANT`, declared and never inferred
     *
     * This was blocked for an evening on ADR-0055 §4: an applicant belongs to
     * no fleet and no client, and *"no fleet and no client"* is the column
     * shape of **head office**. Assigning it by omission would have filed
     * every stranger who fills in the form as Kangaru, which is precisely the
     * silent promotion that guard exists to prevent.
     *
     * The fourth level answers it. `APPLICANT` shares KANGARU's two nulls on
     * purpose — *"the column says which, never the two nulls"* — and both must
     * be **declared**, which is why this is a `forceFill` and not a
     * `create()` argument: `access_level` is deliberately absent from
     * `$fillable` so it can never arrive in a request payload.
     * `BelongsToOperator` and `InheritsKangaruDefaults` already answer
     * `1 = 0` for it, so every scoped read returns nothing.
     *
     * ## Why it can still be skipped
     *
     * **ADR-0027 §5 outranks the convenience.** The public endpoint must
     * *"answer identically whether or not the email is already known to the
     * platform"*, against a population whose whereabouts *"are worth money to
     * the wrong people"*. Creating a user for a taken address would fail on
     * `users_email_unique` and hand a stranger exactly that oracle.
     *
     * So a duplicate is stored with no account and refused at approval in
     * front of a human, and the stranger's response is byte-identical either
     * way. Those applicants — and every application submitted before this —
     * answer a refused document through the emailed claim ticket instead.
     */
    private function mintAccountIfEmailIsFree(DriverApplication $application): void
    {
        if (User::query()->where('email', $application->email)->exists()) {
            return;
        }

        $account = new User;

        $account->forceFill([
            'name' => $application->name,
            'email' => $application->email,
            // The hash the applicant's own choice produced, moved rather than
            // re-made: `User`'s `hashed` cast passes a hash through, so it is
            // never hashed twice and never re-typed. ADR-0027 §3 stands — the
            // password is chosen once, by the person who will type it.
            'password' => $application->password,
            'phone' => $application->phone,
            'role' => 'driver',
            'status' => 'active',
            'access_level' => AccessLevel::APPLICANT,
        ])->save();

        $application->forceFill(['user_id' => $account->getKey()])->save();
    }

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

        /*
            **Before the ticket is put on the model, and the order is
            load-bearing.**

            `upload_token` is an in-memory attribute — the column is
            `upload_token_hash` — so once it is set, any `save()` on this
            instance tries to persist a field that does not exist and dies
            with `Unknown column 'upload_token'`. Minting the account writes
            `user_id` back through this same model, so it has to happen while
            the model is still clean. Found by running it.
        */
        $this->mintAccountIfEmailIsFree($application);

        // Minted in a second write rather than in the `create()` above, so
        // that the plaintext is produced by exactly one method and the row is
        // never constructed with a half-set ticket.
        $application->setAttribute('upload_token', $this->mintUploadToken($application));

        /*
         * "We have it" (mail plan D1).
         *
         * Routed to the address rather than to an account, because at this
         * moment there is no account: `ensureAccount()` runs later in the
         * flow. `Notification::route('mail', ...)` is the same shape
         * `ApplicationDocumentReviewController` already uses to reach an
         * applicant, and `SettingsMailChannel` handles both kinds of
         * recipient.
         *
         * Worth sending at all because the alternative is silence. Somebody
         * has just handed over photographs of their national ID and driving
         * licence to a company they have never dealt with, and heard nothing
         * back. An acknowledgement is the cheapest possible answer to that.
         */
        Notification::route('mail', $application->email)->notify(
            new DriverEventNotification(NotificationType::DRIVER_APPLICATION_RECEIVED),
        );

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

            /*
                **Nothing is approved past its evidence (ADR-0057 §2).**

                The owner's words: *"all their Documents should be accepted."*
                So a document the office has looked at and not accepted blocks
                the button — `pending` because nobody decided, `rejected`
                because somebody did.

                A slot with *no* document does not block, and that asymmetry is
                the point. Every document is optional at submission (ADR-0048
                §6) and the KYC screen says "Nothing here is required" in as
                many words; demanding all six here would make them mandatory
                through a back door and turn that sentence into a lie.
            */
            $blocking = $this->documentsBlockingApproval($locked);

            if ($blocking !== []) {
                throw DriverApplicationDocumentsPendingException::notAccepted($locked, $blocking);
            }

            // The duplicate ADR-0027 §5 deliberately accepted at submission
            // is refused here, in front of a human. Checked in the service
            // rather than left to the users_email_unique index, because
            // ADR-0016's own path catches this in its form request — a rule
            // this path does not pass through — and an integrity violation
            // mid-transaction tells the reviewer nothing about what to do.
            // **Excluding the account this application minted itself.** Before
            // accounts were created at submission this was simply "does an
            // account exist"; now the common case is that one does, and it is
            // ours. What is still refused is a *stranger's* account on the
            // same address, which is the duplicate ADR-0027 §5 deliberately
            // accepted at submission so that a script could not read it.
            $clash = User::query()
                ->where('email', $locked->email)
                ->when($locked->user_id !== null, fn ($query) => $query->whereKeyNot($locked->user_id))
                ->exists();

            if ($clash) {
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

                $vehicleId = Vehicle::create([
                    ...$attributes['vehicle'],
                    'operator_id' => $reviewer->operator_id,
                ])->getKey();
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
                // Which fleet the applicant joins (ADR-0055): the reviewer's.
                //
                // Taken from the actor rather than left to
                // `BelongsToOperator`'s auto-fill, which reads the request's
                // `AccessContext`. That fill is real and correct over HTTP, but
                // it is ambient — and this service is also called directly, by
                // `DriverPromotionsTest` among others, where no middleware has
                // run and the context is unbound. The column is NOT NULL, so
                // the ambient version fails at the database with an SQLSTATE
                // instead of doing the right thing.
                //
                // Wherever the actor is already in hand, ask them. It survives
                // being called from a queue, a command or a test, none of which
                // have a request.
                //
                // **Which fleet a self-registering driver joins when Kangaru
                // sends them** is a real question and F3's to answer — today
                // there is one fleet, and the reviewer is in it.
                'operator_id' => $reviewer->operator_id,
            ]);

            // ADR-0016's endpoint, unchanged and unbypassed: the link is
            // still made by the one service allowed to make it, under the
            // same permissions, with the same exclusivity guarantees.
            //
            // The password travels as the hash the applicant's own choice
            // produced. `User`'s `hashed` cast recognises it and passes it
            // through, so it is never hashed twice and never re-typed.
            /*
                Two ways in, and `DriverAccountService::open()` already knew
                both: `user_id` adopts an account, anything else mints one. So
                ADR-0016's endpoint is still the only thing that makes the
                link, under the same permissions and the same exclusive index
                — this change did not touch it.

                The second branch is not dead code. An application whose email
                was already taken carries no account (see
                `mintAccountIfEmailIsFree`), and so does every application
                submitted before this change. Both are approved through the
                path that existed.
            */
            /*
                **The account stops being an applicant's here.**

                It was minted `AccessLevel::APPLICANT` with no operator, which
                is what kept it inert while nobody had decided about the
                person. Approval decides, and the account has to join the
                fleet the driver just joined — otherwise
                `InheritsKangaruDefaults` keeps answering `1 = 0` for them and
                a freshly approved driver signs in to an app that shows
                nothing and 404s their own trip. Found exactly that way, by
                the end-to-end test below.

                `operator_id` alone: `User::levelFor` derives FLEET from it on
                save, and deriving is the safe direction — the value that
                cannot be inferred is `kangaru`, and this is not it.
            */
            if ($locked->user_id !== null) {
                // **Both columns in one statement.** Writing `operator_id`
                // alone leaves `access_level` reading `applicant`, which
                // requires two nulls — and the `users_access_level_matches_
                // columns` CHECK rejects the row mid-approval with an
                // SQLSTATE. That constraint is the second copy of the rule
                // `AccessLevel::permits()` holds, and it caught this exact
                // raw update, which is what its docblock says it is for.
                User::query()->whereKey($locked->user_id)->update([
                    'operator_id' => $driver->operator_id,
                    'access_level' => AccessLevel::FLEET->value,
                ]);
            }

            $this->accounts->open($driver, $locked->user_id !== null
                ? ['user_id' => $locked->user_id]
                : [
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

            /*
             * "You are approved" (mail plan D3).
             *
             * To the account, not the address: `ensureAccount()` has run, so
             * this person has a `User` and the email can say "sign in with the
             * password you used to apply", which is the one instruction that
             * actually gets them working.
             *
             * Inside the transaction with the rest of it, because an approval
             * nobody is told about is the same failure as an account nobody
             * can sign into. The send itself is queued, so nothing here waits
             * on a network.
             */
            $driver->user?->notify(
                new DriverEventNotification(NotificationType::DRIVER_APPLICATION_APPROVED),
            );

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

            /*
             * "Not this time" (mail plan D4), carrying the office's own words.
             *
             * Routed to the address rather than the account: `reject()` has
             * just cleared this person's password and their upload ticket, and
             * an applicant who was never approved may have no `User` at all.
             * The address on the application is the only thing left that
             * reaches them.
             *
             * The reason is passed through and printed verbatim. A refusal
             * with nothing after it is how somebody concludes the process is
             * arbitrary, and this is a person who handed over their identity
             * documents.
             */
            Notification::route('mail', $locked->email)->notify(
                new DriverEventNotification(
                    NotificationType::DRIVER_APPLICATION_REJECTED,
                    reason: $reason,
                ),
            );

            return $locked;
        });
    }
}
