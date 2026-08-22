<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Access\AccessContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Models\Setting;
use Modules\Administration\Services\SettingsService;
use Modules\Billing\Models\RateCard;
use Modules\Fleet\Models\Zone;
use Modules\Vehicles\Models\VehicleCategory;

/**
 * What a fleet owns, and what it merely inherits (ADR-0055 §5, F1).
 *
 * A null `operator_id` on these four tables means **Kangaru's default** —
 * readable by every fleet, editable only by Kangaru. That is a decision about
 * these four models, never a property of the column: on a walk-in booking the
 * same null will mean *Kangaru's, unclaimed*, and if the two ever merged, every
 * fleet would get every walk-in customer's phone number.
 *
 * As in `CrossFleetIsolationTest`, the rival fleet exists only here — F1 still
 * ships no way to create a second operator, and none may exist until F2.
 */
beforeEach(function () {
    $this->rival = Operator::create([
        'name' => 'Rival Transport Ltd',
        'slug' => 'rival-transport',
        'status' => 'active',
    ]);

    $this->shanitahStaff = User::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::OPERATIONS_MANAGER,
    ]);

    $this->rivalStaff = User::factory()->create([
        'operator_id' => $this->rival->id,
        'role' => UserRole::OPERATIONS_MANAGER,
    ]);

    $this->clientUser = User::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);
});

it('gives a fleet Kangaru defaults plus its own, and no other fleet at all', function () {
    $default = VehicleCategory::create(['key' => 'kangaru_boda', 'name' => 'Boda']);
    $mine = VehicleCategory::create(['key' => 'shanitah_van', 'name' => 'Van', 'operator_id' => Operator::SHANITAH]);
    $theirs = VehicleCategory::create(['key' => 'rival_truck', 'name' => 'Truck', 'operator_id' => $this->rival->id]);

    // Filtered to the three this test made: the migration that created the
    // table seeds nine Kangaru defaults, and counting those in would measure
    // the seed rather than the scope.
    $seen = VehicleCategory::query()
        ->visibleToActor($this->shanitahStaff)
        ->whereIn('key', ['kangaru_boda', 'shanitah_van', 'rival_truck'])
        ->pluck('id');

    // A count, not a `toContain`: the point is that the rival's row is absent,
    // and an existence check passes just as happily when it is present too.
    expect($seen)->toHaveCount(2)
        ->and($seen)->toContain($default->id)
        ->and($seen)->toContain($mine->id)
        ->and($seen)->not->toContain($theirs->id);
});

it('leaves a client unfiltered on the fleet axis, because their fleet is a contract that does not exist yet', function () {
    VehicleCategory::create(['key' => 'kangaru_boda', 'name' => 'Boda']);
    VehicleCategory::create(['key' => 'shanitah_van', 'name' => 'Van', 'operator_id' => Operator::SHANITAH]);

    // The bug this asserts against: a client's user has a null `operator_id`
    // exactly as Kangaru does, and treating the two nulls alike hid every
    // category the office had created. A client's Finance officer could not
    // price their own rate card.
    expect(VehicleCategory::query()
        ->visibleToActor($this->clientUser)
        ->whereIn('key', ['kangaru_boda', 'shanitah_van'])
        ->count())->toBe(2);
});

it('gives head office the defaults it owns and no fleet reference data', function () {
    $hq = new User([
        'name' => 'Head Office',
        'email' => 'hq@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::SUPER_ADMIN,
    ]);
    $hq->access_level = AccessLevel::KANGARU;
    $hq->save();

    $default = VehicleCategory::create(['key' => 'kangaru_boda', 'name' => 'Boda']);
    VehicleCategory::create(['key' => 'shanitah_van', 'name' => 'Van', 'operator_id' => Operator::SHANITAH]);

    $seen = VehicleCategory::query()
        ->visibleToActor($hq)
        ->whereIn('key', ['kangaru_boda', 'shanitah_van'])
        ->pluck('id');

    expect($seen->all())->toBe([$default->id]);
});

it('lets a fleet edit its own reference data and never Kangaru shared defaults', function () {
    $default = VehicleCategory::create(['key' => 'kangaru_boda', 'name' => 'Boda']);
    $mine = VehicleCategory::create(['key' => 'shanitah_van', 'name' => 'Van', 'operator_id' => Operator::SHANITAH]);

    $editable = VehicleCategory::query()
        ->ownedByFleet(Operator::SHANITAH)
        ->whereIn('key', ['kangaru_boda', 'shanitah_van'])
        ->pluck('id');

    // Reading a default and editing it are different questions, which is why
    // there are two scopes. One scope used for both would let any fleet
    // rename a category every other fleet reads.
    expect($editable->all())->toBe([$mine->id])
        ->and($editable)->not->toContain($default->id);
});

it('resolves a fleet override over the Kangaru default it shadows', function () {
    Setting::create(['group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => false]);
    Setting::create([
        'group' => 'ordering',
        'key' => 'walk_in_enabled',
        'value' => true,
        'operator_id' => Operator::SHANITAH,
    ]);

    Cache::flush();
    app(AccessContext::class)->bindFleet(Operator::SHANITAH);
    expect(app(SettingsService::class)->get('ordering', 'walk_in_enabled'))->toBeTrue();

    // The rival inherits the default, unchanged by Shanitah's choice. This is
    // the assertion that catches the sort order in `SettingsService::stored()`
    // being reversed — the override would silently stop applying.
    Cache::flush();
    app(AccessContext::class)->bindFleet($this->rival->id);
    expect(app(SettingsService::class)->get('ordering', 'walk_in_enabled'))->toBeFalse();
});

it('caches settings per fleet, so one fleet never serves another its overrides', function () {
    Setting::create(['group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => false]);
    Setting::create([
        'group' => 'ordering',
        'key' => 'walk_in_enabled',
        'value' => true,
        'operator_id' => Operator::SHANITAH,
    ]);

    Cache::flush();

    // Shanitah reads first and warms its entry; the rival must not be served
    // it. One `settings.all` key for everybody was the shape before F1.
    app(AccessContext::class)->bindFleet(Operator::SHANITAH);
    expect(app(SettingsService::class)->get('ordering', 'walk_in_enabled'))->toBeTrue();

    app(AccessContext::class)->bindFleet($this->rival->id);
    expect(app(SettingsService::class)->get('ordering', 'walk_in_enabled'))->toBeFalse();
});

it('keeps the walk-in tariff Kangaru s, not a fleet with a client-less card', function () {
    // The public tariff: no client and no fleet.
    $tariff = RateCard::allTenants()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'name' => 'Public tariff',
        'status' => 'active',
        'is_default' => true,
    ]);

    // A fleet marking a client-less card as its default must not become the
    // price every walk-in on the platform pays.
    RateCard::allTenants()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'name' => 'Shanitah house rate',
        'status' => 'active',
        'is_default' => true,
    ]);

    $resolved = RateCard::allTenants()
        ->whereNull('tenant_id')
        ->whereNull('operator_id')
        ->where('is_default', true)
        ->where('status', 'active')
        ->get();

    expect($resolved)->toHaveCount(1)
        ->and($resolved->first()->id)->toBe($tariff->id);
});

it('scopes zones to the fleet whose operating patch they are', function () {
    $mine = Zone::create([
        'name' => 'Kampala Central', 'kind' => 'service_area', 'boundary' => [],
        'operator_id' => Operator::SHANITAH,
    ]);
    $theirs = Zone::create([
        'name' => 'Rival Patch', 'kind' => 'service_area', 'boundary' => [],
        'operator_id' => $this->rival->id,
    ]);

    $seen = Zone::query()->visibleToActor($this->shanitahStaff)->pluck('id');

    expect($seen)->toContain($mine->id)
        ->and($seen)->not->toContain($theirs->id);
});

/**
 * The uniqueness half, which needed a generated column to work at all.
 *
 * MySQL and MariaDB both treat NULLs in a unique index as distinct, so a plain
 * `unique(operator_id, group, key)` would let two Kangaru defaults exist — for
 * the rows that are all of them today. `operator_scope` collapses the null to
 * 0, which no fleet can hold because `operators.id` starts at 1.
 */
it('refuses a second Kangaru default for the same setting', function () {
    Setting::create(['group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => false]);

    expect(fn () => DB::table('settings')->insert([
        'group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => json_encode(true),
        'created_at' => now(), 'updated_at' => now(),
    ]))->toThrow(QueryException::class);
});

it('allows a fleet override beside the default it shadows', function () {
    Setting::create(['group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => false]);
    Setting::create([
        'group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => true,
        'operator_id' => Operator::SHANITAH,
    ]);

    expect(Setting::query()->where('key', 'walk_in_enabled')->count())->toBe(2);
});

it('refuses two overrides of one setting by one fleet', function () {
    Setting::create([
        'group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => true,
        'operator_id' => Operator::SHANITAH,
    ]);

    expect(fn () => DB::table('settings')->insert([
        'operator_id' => Operator::SHANITAH,
        'group' => 'ordering', 'key' => 'walk_in_enabled', 'value' => json_encode(false),
        'created_at' => now(), 'updated_at' => now(),
    ]))->toThrow(QueryException::class);
});
