<?php

namespace Modules\Fleet\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Requests\StorePresencePingRequest;
use Modules\Fleet\Requests\UpdateDutyRequest;
use Modules\Fleet\Resources\DriverPresenceResource;
use Modules\Fleet\Services\Availability;
use Modules\Fleet\Services\AvailabilityService;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Models\Trip;

/**
 * A driver going on duty, and saying where they are (ADR-0024 §2).
 *
 * The half of automatic dispatch that was missing: before this, the matcher
 * ranked by `live_positions`, which the GPS pipeline only writes from Trip
 * Started onward — so a driver waiting at a stage for work reported nothing,
 * and "the nearest driver" was a question with no data behind it.
 *
 * ## `/me/`, like the time-off routes next to it
 *
 * No id in the path and no `driver_id` in either body. The driver is the
 * token. `DriverAvailabilityController` explains the reasoning at length and
 * it is the same reasoning: an id in the path is a thing to tamper with, and
 * a driver must not be able to sign a colleague on for a shift or park them
 * at a set of coordinates.
 *
 * ## Availability decides, presence narrows
 *
 * Going on duty is checked against `AvailabilityService`, which is the one
 * place rosters, approved leave and driver status are combined (ADR-0017).
 * A driver on approved leave who opens the app is refused here by the same
 * code that refuses a dispatcher trying to assign them — because the
 * alternative is two answers to "is this driver available", and dispatch
 * would be the one to discover they disagree.
 *
 * Note what is *not* checked: a live trip. A driver mid-journey is on duty
 * by definition, and `AvailabilityService` counts an occupying trip as a
 * conflict — correctly, for assignment. Refusing duty on that basis would
 * sign a driver out the moment they accepted work.
 */
class DriverPresenceController extends Controller
{
    public function __construct(
        private readonly DriverPresenceStore $presence,
        private readonly AvailabilityService $availability,
    ) {}

    /** The caller's own duty state, so the app can restore it on launch. */
    public function show(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        return ApiResponse::success(
            new DriverPresenceResource($this->presence->get($driver->id) ?? $this->offDuty($driver->id)),
        );
    }

    public function update(UpdateDutyRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $onDuty = $request->boolean('on_duty');

        if ($onDuty) {
            $refusal = $this->refusalToStartShift($driver);

            if ($refusal !== null) {
                return $refusal;
            }
        }

        $this->presence->setDuty(
            $driver->id,
            $onDuty,
            $onDuty ? $this->vehicleFor($driver, $request->integer('vehicle_id') ?: null) : null,
        );

        return ApiResponse::success(
            new DriverPresenceResource($this->presence->get($driver->id) ?? $this->offDuty($driver->id)),
            $onDuty ? 'You are on duty. Jobs will come to this phone.' : 'You are off duty.',
        );
    }

    /**
     * A position heartbeat.
     *
     * 202, not 201: nothing is created — one row is overwritten in place —
     * and the store may legitimately discard this ping as older than the one
     * it holds. Answering 201 would promise a record that may not exist.
     */
    public function ping(StorePresencePingRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $stored = $this->presence->get($driver->id);

        // A heartbeat from a driver who is not on duty is refused rather
        // than silently dropped. The app stops sending them at sign-off, so
        // one arriving means the two disagree about whether a shift is
        // running — and the app needs to be told, not ignored, or it keeps
        // showing a driver as online while dispatch has written them off.
        if ($stored === null || ! $stored->onDuty) {
            return ApiResponse::error(
                ErrorCode::NOT_ON_DUTY,
                'You are not on duty, so your position is not being used to find you work.',
                [],
                409,
            );
        }

        $this->presence->heartbeat(new DriverPresence(
            driverId: $driver->id,
            // Not read from the request, and never writable here: only
            // `setDuty` moves this. A heartbeat that could turn duty back on
            // would put a driver who has just signed off — and pocketed the
            // phone — straight back into the pool on their last in-flight
            // request.
            onDuty: true,
            vehicleId: $request->integer('vehicle_id') ?: $stored->vehicleId,
            latitude: (float) $request->float('latitude'),
            longitude: (float) $request->float('longitude'),
            accuracyMetres: $request->filled('accuracy_metres') ? (float) $request->float('accuracy_metres') : null,
            recordedAt: CarbonImmutable::parse((string) $request->string('recorded_at')),
        ));

        return ApiResponse::success(
            new DriverPresenceResource($this->presence->get($driver->id) ?? $this->offDuty($driver->id)),
            'Position noted.',
            202,
        );
    }

    /**
     * Which vehicle this driver is on shift with.
     *
     * Whatever they said, and otherwise **the one they drove last**.
     *
     * The fallback is not a convenience. A driver on duty with no vehicle is
     * ranked by the matcher and then dropped as unofferable — they appear in
     * the pool, score well on distance, and can never be sent anything. That
     * is exactly what happened the first time this was run end to end: the
     * app sends the vehicle the server already knew about, which on a first
     * sign-on is nothing, so going on duty *cleared* the vehicle a
     * dispatcher had set and made the driver permanently unofferable.
     *
     * Their last trip is the best answer the platform actually holds:
     * `drivers` has no vehicle column, and a driver in Kampala turns up in
     * the same car most days. It is a default, not a decision — an explicit
     * `vehicle_id` always wins, and the depot can still reassign.
     *
     * Null when they have never driven anything. That driver still goes on
     * duty and is still ranked; they simply cannot be sent a job until
     * somebody says what they are driving, and the API says so rather than
     * guessing.
     */
    private function vehicleFor(Driver $driver, ?int $stated): ?int
    {
        if ($stated !== null) {
            return $stated;
        }

        // Their own vehicle, which for most drivers here — and for every
        // boda rider — is simply *the* answer. Preferred over the last trip
        // because it is a stated fact rather than an inference.
        if ($driver->vehicle_id !== null) {
            return $driver->vehicle_id;
        }

        $existing = $this->presence->get($driver->id);

        if ($existing?->vehicleId !== null) {
            return $existing->vehicleId;
        }

        // `allTenants()`: a driver's last trip may have been a walk-in, which
        // carries no tenant, and nothing is bound in this request anyway —
        // `TenantScope` would fail closed and answer null for every driver.
        return Trip::allTenants()
            ->where('driver_id', $driver->id)
            ->latest('id')
            ->value('vehicle_id');
    }

    /**
     * Why this driver may not start a shift, or null if they may.
     *
     * The window asked about is "now", not the assumed trip duration: this
     * is "may you begin working", and a driver whose leave starts in an hour
     * is entitled to the hour.
     */
    private function refusalToStartShift(Driver $driver): ?JsonResponse
    {
        $now = CarbonImmutable::now();
        $verdict = $this->availability->forDriver($driver->id, $now, $now);

        if ($verdict->free) {
            return null;
        }

        /*
         * Being on a trip is not a reason to refuse a shift — it is the most
         * on-duty a driver can possibly be.
         *
         * `forDriver` answers the *dispatcher's* question, "may I give this
         * driver another job", and for that an occupying trip is exactly the
         * right refusal. This is a different question: "may this driver begin
         * working". Reusing the verdict wholesale conflated the two, and the
         * result locked drivers out of their own duty switch — a driver
         * carrying a passenger who closed the app and reopened it, or who
         * signed off by accident mid-job, got `409 ON_TRIP` and could not get
         * back on duty until somebody completed the trip for them. Found on a
         * live server: driver 7 sat off duty in the app while holding trip
         * #14, with no way back in.
         *
         * Every other code still refuses, and those are the ones this guard
         * was written for: `OUT_OF_SERVICE` is a suspension, `BLOCKED` is
         * leave, `OFF_SHIFT` is a roster. Those say the driver should not be
         * working at all. `ON_TRIP` says the opposite.
         */
        if ($verdict->code === Availability::ON_TRIP) {
            return null;
        }

        // The service's own sentence, verbatim. It already says whether this
        // is leave, a roster or a suspension, and rewriting it here would be
        // a second copy of ADR-0017's vocabulary drifting from the first —
        // and the driver would be told something different depending on
        // which screen refused them.
        return ApiResponse::error(
            ErrorCode::DRIVER_UNAVAILABLE,
            $verdict->note ?? 'You cannot go on duty right now. Check with the fleet office.',
            [],
            409,
        );
    }

    /**
     * The answer for a driver who has never reported.
     *
     * A synthesised off-duty record rather than a null or a 404: "you are
     * off duty" is the true and useful answer on first launch, and a client
     * forced to treat an empty response as off-duty is a client that will
     * eventually treat a failed request as off-duty too.
     */
    private function offDuty(int $driverId): DriverPresence
    {
        return new DriverPresence(
            driverId: $driverId,
            onDuty: false,
            vehicleId: null,
            latitude: null,
            longitude: null,
            accuracyMetres: null,
            recordedAt: null,
        );
    }

    /** @see DriverAvailabilityController::driverFor() — same rule, same reason. */
    private function driverFor(Request $request): ?Driver
    {
        /** @var User $user */
        $user = $request->user();

        return Driver::query()->where('user_id', $user->id)->first();
    }

    /** @see DriverAvailabilityController::notADriver() */
    private function notADriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_A_DRIVER,
            'This account is not linked to a driver profile, so it cannot go on duty.',
            [],
            403,
        );
    }
}
