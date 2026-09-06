<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\OperatorClient;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\Booking;

/**
 * ADR-0064 §2: a fleet books **for a corporate client**.
 *
 * `bookings.tenant_id` is NOT NULL and a platform actor has no tenant, so
 * the internal booking endpoint had never served the desk at all —
 * `ColleagueBookingTest` records the gap in as many words. The fix is not a
 * nullable column but an answered question: the desk names which client the
 * call is from, and the booking is that client's from the first write.
 *
 * The refusals are the point of the file: an unserved client and a
 * nonexistent one must be indistinguishable (the enumeration lesson
 * `BookingIndexRequest` documents), and a colleague from the wrong client
 * must not ride into another client's booking because two dropdowns
 * disagreed.
 */

/**
 * @return array{fleet: User, bank: Tenant, banker: User, rival: Tenant, telecom: Tenant, engineer: User}
 */
function fleetBookingFixture(): array
{
    $fleet = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::DISPATCHER,
    ]);

    $bank = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $banker = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Joseph Mukasa',
        'phone' => '+256700111222',
        'email' => 'joseph.mukasa@centenary.test',
    ]);

    // A second served client, for the crossed-dropdowns case.
    $telecom = Tenant::factory()->create(['name' => 'MTN']);
    // Shares a surname with the banker on purpose: the colleague-search
    // test below needs one term matching a person on each client, so the
    // narrowing — not the search term — is what the assertion proves.
    $engineer = User::factory()->create([
        'tenant_id' => $telecom->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Grace Mukasa',
        'email' => 'grace.mukasa@mtn.test',
    ]);

    // On Kangaru, but nobody serves them — the tenant a booking must not
    // land on and the client list must not confirm exists.
    $rival = Tenant::factory()->create(['name' => 'Unserved Ltd']);

    foreach ([$bank, $telecom] as $client) {
        OperatorClient::query()->firstOrCreate(
            ['operator_id' => Operator::SHANITAH, 'tenant_id' => $client->id],
            ['status' => OperatorClient::ACTIVE],
        );
    }

    return compact('fleet', 'bank', 'banker', 'rival', 'telecom', 'engineer');
}

/** @param array<string, mixed> $overrides */
function fleetBooking(User $actor, array $overrides = [])
{
    return test()->actingAs($actor, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_name' => 'A Caller',
        'passenger_phone' => '+256700333444',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
        ...$overrides,
    ]);
}

it('lets the desk book for a client it serves, and the booking is that client\'s', function () {
    ['fleet' => $fleet, 'bank' => $bank] = fleetBookingFixture();

    fleetBooking($fleet, ['tenant_id' => $bank->id])
        ->assertCreated()
        ->assertJsonPath('data.tenant_id', $bank->id);

    $stored = Booking::allTenants()->firstOrFail();
    expect($stored->tenant_id)->toBe($bank->id);
    // Who ran it, stamped at creation (RecordsActingFleet) — invoice
    // numbering keys on it, so a null here surfaces weeks later as money.
    expect($stored->operator_id)->toBe(Operator::SHANITAH);
});

it('requires the desk to name the client', function () {
    ['fleet' => $fleet] = fleetBookingFixture();

    fleetBooking($fleet)
        ->assertStatus(422)
        ->assertJsonValidationErrors('tenant_id');

    expect(Booking::allTenants()->count())->toBe(0);
});

it('answers an unserved client and a nonexistent one identically', function () {
    ['fleet' => $fleet, 'rival' => $rival] = fleetBookingFixture();

    $unserved = fleetBooking($fleet, ['tenant_id' => $rival->id]);
    $imaginary = fleetBooking($fleet, ['tenant_id' => 999999]);

    $unserved->assertStatus(422)->assertJsonValidationErrors('tenant_id');

    // Byte-identical, so watching the two responses cannot tell a fleet
    // which client ids exist on the platform.
    expect($imaginary->getContent())->toBe($unserved->getContent());
    expect(Booking::allTenants()->count())->toBe(0);
});

it('refuses a colleague who is not the chosen client\'s person', function () {
    ['fleet' => $fleet, 'bank' => $bank, 'engineer' => $engineer] = fleetBookingFixture();

    // Both halves individually valid — MTN is served, so Grace resolves in
    // the picker's range — and still refused, because the booking is the
    // bank's and Grace is not the bank's to book for.
    fleetBooking($fleet, ['tenant_id' => $bank->id, 'passenger_user_id' => $engineer->id])
        ->assertStatus(422)
        ->assertJsonValidationErrors('passenger_user_id');

    expect(Booking::allTenants()->count())->toBe(0);
});

it('books the named colleague of the named client under their account name', function () {
    ['fleet' => $fleet, 'bank' => $bank, 'banker' => $banker] = fleetBookingFixture();

    fleetBooking($fleet, ['tenant_id' => $bank->id, 'passenger_user_id' => $banker->id])
        ->assertCreated()
        ->assertJsonPath('data.tenant_id', $bank->id)
        ->assertJsonPath('data.passenger_user_id', $banker->id)
        ->assertJsonPath('data.passenger_name', 'Joseph Mukasa');
});

it('ignores a client actor\'s tenant_id — their booking is their own client\'s', function () {
    ['bank' => $bank, 'banker' => $banker, 'telecom' => $telecom] = fleetBookingFixture();

    $admin = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    // Naming another client changes nothing: for an actor with one client
    // the key is not a recognised input at all, and validating it would
    // itself be the oracle (see BookingIndexRequest on exactly this).
    fleetBooking($admin, ['tenant_id' => $telecom->id, 'passenger_user_id' => $banker->id])
        ->assertCreated()
        ->assertJsonPath('data.tenant_id', $bank->id);

    expect(Booking::allTenants()->where('tenant_id', $telecom->id)->count())->toBe(0);
});

it('offers only the clients the fleet serves as bookable', function () {
    ['fleet' => $fleet] = fleetBookingFixture();

    // `filters.clients` spans existing rows and may name more; this list is
    // what the New Booking dialog offers, and everything on it must be an
    // answer the store endpoint accepts (ADR-0064 §5).
    $labels = collect(
        test()->actingAs($fleet, 'sanctum')
            ->getJson('/api/v1/bookings')
            ->assertOk()
            ->json('meta.bookable_clients'),
    )->pluck('label');

    expect($labels)->toContain('Centenary Bank')
        ->toContain('MTN')
        ->not->toContain('Unserved Ltd');
});

it('offers a client\'s own user nobody to book for but themselves', function () {
    ['bank' => $bank] = fleetBookingFixture();

    $admin = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    test()->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/bookings')
        ->assertOk()
        ->assertJsonPath('meta.bookable_clients', []);
});

it('fills the contact number from the named colleague\'s saved one', function () {
    ['fleet' => $fleet, 'bank' => $bank, 'banker' => $banker] = fleetBookingFixture();

    // No `passenger_phone` in the payload at all — the account's saved
    // work number stands in (owner's ask, 24 Aug), exactly as the dialog
    // prefills it visibly.
    $response = test()->actingAs($fleet, 'sanctum')->postJson('/api/v1/bookings', [
        'tenant_id' => $bank->id,
        'passenger_user_id' => $banker->id,
        'passenger_name' => 'ignored',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ]);

    $response->assertCreated()->assertJsonPath('data.passenger_phone', '+256700111222');
});

it('still prefers a typed number over the colleague\'s saved one', function () {
    ['fleet' => $fleet, 'bank' => $bank, 'banker' => $banker] = fleetBookingFixture();

    // The person raising the booking may know a better number for today —
    // the account's is a default, never an override.
    fleetBooking($fleet, [
        'tenant_id' => $bank->id,
        'passenger_user_id' => $banker->id,
        'passenger_phone' => '+256788000111',
    ])
        ->assertCreated()
        ->assertJsonPath('data.passenger_phone', '+256788000111');
});

it('says so on the field when the colleague has no saved number and none was typed', function () {
    ['bank' => $bank] = fleetBookingFixture();

    $admin = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);
    $numberless = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'phone' => null,
    ]);

    test()->actingAs($admin, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $numberless->id,
        'passenger_name' => 'ignored',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('passenger_phone');
});

it('narrows the colleague search to the chosen client for a fleet actor', function () {
    ['fleet' => $fleet, 'bank' => $bank] = fleetBookingFixture();

    // Both clients hold a Mukasa — the narrowing, not the term, is what
    // keeps MTN's person out of a booking the bank is on the phone about.
    $names = test()->actingAs($fleet, 'sanctum')
        ->getJson("/api/v1/colleagues?q=Mukasa&tenant_id={$bank->id}")
        ->assertOk()
        ->json('data.*.name');

    expect($names)->toContain('Joseph Mukasa')->not->toContain('Grace Mukasa');
});

it('refuses the tenant filter on the colleague search from a client actor', function () {
    ['bank' => $bank, 'telecom' => $telecom] = fleetBookingFixture();

    $admin = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    test()->actingAs($admin, 'sanctum')
        ->getJson("/api/v1/colleagues?q=Joseph&tenant_id={$telecom->id}")
        ->assertStatus(422)
        ->assertJsonValidationErrors('tenant_id');
});
