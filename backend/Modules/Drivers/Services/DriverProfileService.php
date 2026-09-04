<?php

namespace Modules\Drivers\Services;

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;

/**
 * The facts on a driver's own profile screen.
 *
 * **Separate from `DriverStatsService` on purpose.** Stats is polled by the
 * home screen every sixty seconds and answers "how am I doing today"; this is
 * opened deliberately and answers "who am I on this platform". Folding them
 * together would make every home-screen poll pay for a lifetime `COUNT`, a
 * vehicle join and a documents summary that nobody is looking at — the same
 * argument that kept `me/earnings` off `me/stats`.
 *
 * Nothing here is estimated. The rating is deliberately **not** served from
 * this endpoint even though the screen shows one: `me/stats` already produces
 * it under ADR-0030's withholding rule, and a second reading of a number that
 * is suppressed below five ratings is a second chance to publish it by
 * mistake.
 *
 * The payload shape is an alias rather than a docblock repeated on the two
 * methods that return it — `update()` returns exactly what `forDriver()` does,
 * because a screen that has just saved should re-render from the same facts it
 * would have fetched.
 *
 * @phpstan-type DriverProfilePayload array{
 *     name: string,
 *     phone: string|null,
 *     email: string|null,
 *     photo_url: string|null,
 *     member_since: string|null,
 *     trips_total: int,
 *     vehicle: array{make: string|null, model: string|null, registration_number: string, category: string, category_label: string}|null,
 *     documents: array{state: string, verified: int, total: int, action_needed: int, pending: int}
 * }
 */
class DriverProfileService
{
    /**
     * The only columns a driver may write on their own record.
     *
     * Asserted by a test rather than left as a convention: the cost of a fifth
     * entry appearing here unnoticed is a driver editing their own licence
     * expiry or lifting their own suspension. See `update()`.
     *
     * @var list<string>
     */
    public const SELF_EDITABLE = ['name', 'phone'];

    public function __construct(private readonly DriverDocumentService $documents) {}

    /**
     * Where the app fetches this driver's photograph, or null.
     *
     * `route()` rather than `Storage::url()`: the file is on the private disk
     * and is streamed through the API, because a signed link to a photograph
     * of somebody is addressable by anyone who ever saw it — and this one is
     * loaded dozens of times a day, so the link would travel.
     */
    private function photoUrl(Driver $driver): ?string
    {
        $path = $driver->photo_path;

        if (! is_string($path) || $path === '') {
            return null;
        }

        return route('me.photo.show').'?v='.substr(sha1($path), 0, 8);
    }

    /**
     * A driver correcting their own name or phone number.
     *
     * **Writes only the keys that arrived.** `UpdateDriverProfileRequest`
     * allows either field alone, and `fill()` over the validated array keeps
     * that promise — a PATCH carrying a phone number cannot blank a name.
     *
     * **The allow-list here is not redundant with the form request, and
     * `$fillable` is no help at all.** `Driver::$fillable` contains `status`,
     * `license_number`, `license_expiry` and `vehicle_id` — it has to, because
     * the office's own update path fills them. So mass assignment protects
     * nothing on this route, and the *only* thing standing between a driver and
     * their own suspension flag would be one form request's rules. A key added
     * to that file by somebody solving a different problem would reach this
     * `fill()` unopposed.
     *
     * Naming the two fields at the write site is the second lock, and it is the
     * same instinct `docs/screen-rules.md` §2 applies to responses: allow-list,
     * never spread. `SELF_EDITABLE` is asserted directly by a test, so adding a
     * field to it is a deliberate act with a diff somebody reviews.
     *
     * The audit trail comes free: `Driver` is `Auditable`, so the office can
     * see that the driver changed it and what it was before.
     *
     * @param  array<string, mixed>  $attributes  already validated
     * @return DriverProfilePayload
     */
    public function update(Driver $driver, array $attributes): array
    {
        $driver->fill(Arr::only($attributes, self::SELF_EDITABLE))->save();

        return $this->forDriver($driver->refresh());
    }

    /**
     * @return DriverProfilePayload
     */
    public function forDriver(Driver $driver): array
    {
        $driver->loadMissing('vehicle');
        $vehicle = $driver->vehicle;

        return [
            'name' => $driver->name,
            // The driver's *profile* phone, not the account's. A driver signs
            // in with an email (ADR-0016) and is reached on this number, and
            // the two belong to different records on purpose.
            'phone' => $driver->phone,
            'email' => $driver->email,
            /*
             * A route, never a storage path, and null when there is none
             * (ADR-0041).
             *
             * **Cache-busted on the stored path.** Without the query the app's
             * image cache goes on showing the previous portrait after an
             * upload — on the one surface whose whole job is telling a driver
             * this account is theirs.
             */
            'photo_url' => $this->photoUrl($driver),
            // A date, not a datetime: "Member since" is rendered as a month
            // and a year, and an instant would invite a timezone question the
            // answer does not depend on.
            'member_since' => $driver->created_at?->toDateString(),
            'trips_total' => $this->tripsCompleted($driver),
            'vehicle' => $vehicle === null ? null : [
                // Nullable, and genuinely so: `make` and `model` are optional
                // columns on `vehicles`, and a plate with no make is a real
                // row a depot may have typed in a hurry. The app renders what
                // it is given rather than assembling a name from blanks.
                'make' => $vehicle->make,
                'model' => $vehicle->model,
                'registration_number' => $vehicle->registration_number,
                'category' => $vehicle->category,
                // Served rather than title-cased on the handset. The category
                // list is `Vehicle::CATEGORIES` and Billing prices against it;
                // a second spelling of it in a mobile bundle is a second place
                // to be wrong when a category is added.
                'category_label' => ucfirst($vehicle->category),
            ],
            'documents' => $this->documents->complianceFor($driver),
        ];
    }

    /**
     * Every trip this driver has finished, ever.
     *
     * The mockup drew "(428 trips)" beside the rating. It is a count of rows
     * that exist, so it is allowed — unlike the rating beside it, which is
     * withheld until there are five of them.
     *
     * **Completed only.** A cancellation is not a trip a driver did, and
     * counting it would make the figure beside somebody's rating flatter than
     * their work. Soft-deleted trips are excluded for the same reason every
     * other count in this module excludes them.
     */
    /**
     * Public because the Performance screen shows the same lifetime figure,
     * and a second copy of this query is a second place for "does a
     * cancellation count as a trip" to be answered differently. It does not —
     * the number sits beside a rating on both screens and must not read
     * flatter than the driver's work.
     */
    public function tripsCompleted(Driver $driver): int
    {
        return (int) DB::table('trips')
            ->where('driver_id', $driver->getKey())
            ->where('status', TripStatus::TRIP_COMPLETED->value)
            ->whereNull('deleted_at')
            ->count();
    }
}
