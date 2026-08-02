<?php

use App\Exceptions\FinancialRecordImmutableException;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\Money\Shillings;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\InvoiceLine;
use Modules\Billing\Services\RateCardService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Trips\Services\TripService;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

function generateInvoice(User $actor, Trip $trip, string $key, array $body = []): TestResponse
{
    return test()
        ->withHeader('Idempotency-Key', $key)
        ->actingAs($actor, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice", $body);
}

it('issues an invoice for a completed trip and moves the trip to Invoice Generated', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    $response = generateInvoice($finance, $trip, 'idem-first-invoice-0001');

    $response->assertStatus(201)
        ->assertJsonPath('data.invoice_number', 'INV-'.now()->format('Y').'-000001')
        ->assertJsonPath('data.total_minor', 26_000)
        ->assertJsonPath('data.balance_minor', 26_000)
        ->assertJsonPath('data.credited_minor', 0);

    // The trip records that it was billed, through the state machine, so
    // the transition lands in the append-only timeline like every other.
    expect($trip->fresh()->status)->toBe(TripStatus::INVOICE_GENERATED);
    expect(TripEvent::where('trip_id', $trip->id)
        ->where('to_status', TripStatus::INVOICE_GENERATED->value)->count())->toBe(1);
});

it('stores every input on each line so the invoice can be reproduced from storage alone', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        waitingPeriodSeconds: [15 * 60],
    );

    generateInvoice($finance, $trip, 'idem-reproducible-0001')->assertStatus(201);

    $invoice = Invoice::where('trip_id', $trip->id)->firstOrFail();

    // AGENTS.md: "An invoice must be fully reproducible from stored data."
    // Every line re-derives its own amount from nothing but its own stored
    // columns, and the sum of them is the invoice total. If either of these
    // ever fails, the invoice cannot be defended in a billing dispute.
    $recomputedTotal = Shillings::zero();

    foreach ($invoice->lines as $line) {
        expect(Shillings::toMinor($line->recompute()))
            ->toBe(Shillings::toMinor($line->amount()), "line {$line->line_number} does not reproduce");

        $recomputedTotal = $recomputedTotal->plus($line->recompute());
    }

    expect(Shillings::toMinor($recomputedTotal))->toBe(Shillings::toMinor($invoice->total()));

    // And the inputs AGENTS.md names by hand.
    $distance = $invoice->lines->firstWhere('type', InvoiceLineType::DISTANCE);
    expect($distance->rate_card_version_id)->toBe($version->id);
    expect($distance->vehicle_category)->toBe('sedan');
    expect((float) $distance->distance_km)->toBe(42.0);
    expect($distance->rounding_mode)->toBe($version->rounding_mode);

    $waiting = $invoice->lines->firstWhere('type', InvoiceLineType::WAITING);
    expect($waiting->waiting_minutes)->toBe(5);
});

it('returns the original invoice on a replay of the same idempotency key', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    $first = generateInvoice($finance, $trip, 'idem-replay-me-0001')->assertStatus(201);

    // The same request again — a client that never saw our response and
    // retried. It must get the original back, not a second invoice.
    $second = generateInvoice($finance, $trip, 'idem-replay-me-0001')->assertStatus(200);

    expect($second->json('data.uuid'))->toBe($first->json('data.uuid'));
    expect($second->json('data.invoice_number'))->toBe($first->json('data.invoice_number'));
    expect(Invoice::where('trip_id', $trip->id)->count())->toBe(1);

    // And the replay did not advance the tenant's invoice sequence: a
    // consumed-but-unused number would show up as a gap, which for a bank
    // client is an audit finding.
    expect(DB::table('document_number_sequences')
        ->where('tenant_id', $tenant->id)->value('next_number'))->toBe(2);
});

it('refuses a second invoice for the same trip under a different key', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    generateInvoice($finance, $trip, 'idem-original-key-01')->assertStatus(201);

    generateInvoice($finance, $trip, 'idem-a-different-key')
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_ALREADY_INVOICED');

    expect(Invoice::where('trip_id', $trip->id)->count())->toBe(1);
});

it('refuses to spend one idempotency key on two different trips', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $first = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    generateInvoice($finance, $first, 'idem-shared-key-001')->assertStatus(201);

    $otherVehicle = Vehicle::factory()->create(['category' => 'sedan']);
    $second = BillingFixtures::completedTrip($tenant, $dispatcher, $otherVehicle, $driver);

    // Handing back the first trip's invoice would silently answer a
    // question nobody asked, so this is a refusal rather than a replay.
    generateInvoice($finance, $second, 'idem-shared-key-001')
        ->assertStatus(409)
        ->assertJsonPath('code', 'IDEMPOTENCY_KEY_REUSED');

    expect(Invoice::count())->toBe(1);
});

it('requires an idempotency key', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    // No header, no body field. The server does not invent one: a
    // server-side default cannot distinguish a retry from a second
    // deliberate charge, which is the only thing the mechanism is for.
    $this->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice")
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');

    expect(Invoice::count())->toBe(0);
});

it('refuses to invoice a trip that has not been completed', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    // Assigned, not completed: no closing odometer, so no distance to bill
    // and nothing to reproduce the charge from later.
    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $dispatcher);

    generateInvoice($finance, $trip, 'idem-too-early-0001')
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_NOT_INVOICEABLE');

    expect(Invoice::count())->toBe(0);
    expect($trip->fresh()->status)->toBe(TripStatus::ASSIGNED);
});

it('refuses to invoice when the tenant has no default rate card, and writes nothing', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    $card->is_default = false;
    $card->save();

    generateInvoice($finance, $trip, 'idem-no-card-00001')
        ->assertStatus(422)
        ->assertJsonPath('code', 'RATE_CARD_NOT_CONFIGURED');

    // The whole thing rolls back: no invoice, no consumed invoice number,
    // and the trip is still billable once somebody sets a default card.
    //
    // The counter *row* exists — it is created before the transaction opens,
    // to avoid a deadlock between two simultaneous first-ever invoices. What
    // matters is that no number was consumed, so the first invoice this
    // tenant does issue is still 000001 and there is no gap to explain.
    expect(Invoice::count())->toBe(0);
    expect((int) DB::table('document_number_sequences')->value('next_number'))->toBe(1);
    expect($trip->fresh()->status)->toBe(TripStatus::TRIP_COMPLETED);
});

it('numbers invoices sequentially per tenant, and never shares a series between tenants', function () {
    ['tenant' => $tenantA, 'finance' => $financeA, 'dispatcher' => $dispatcherA,
        'vehicle' => $vehicleA, 'driver' => $driverA] = BillingFixtures::tenantWithRateCard();

    $tripA1 = BillingFixtures::completedTrip($tenantA, $dispatcherA, $vehicleA, $driverA);
    $vehicleA2 = Vehicle::factory()->create(['category' => 'sedan']);
    $tripA2 = BillingFixtures::completedTrip($tenantA, $dispatcherA, $vehicleA2, $driverA);

    $year = now()->format('Y');

    generateInvoice($financeA, $tripA1, 'idem-tenant-a-one01')
        ->assertJsonPath('data.invoice_number', "INV-{$year}-000001");
    generateInvoice($financeA, $tripA2, 'idem-tenant-a-two01')
        ->assertJsonPath('data.invoice_number', "INV-{$year}-000002");

    // A second tenant starts its own series at 1. Sharing one would leak
    // this tenant's invoice volume to the other, and would put gaps in both.
    ['tenant' => $tenantB, 'finance' => $financeB, 'dispatcher' => $dispatcherB,
        'vehicle' => $vehicleB, 'driver' => $driverB] = BillingFixtures::tenantWithRateCard();

    $tripB1 = BillingFixtures::completedTrip($tenantB, $dispatcherB, $vehicleB, $driverB);

    generateInvoice($financeB, $tripB1, 'idem-tenant-b-one01')
        ->assertJsonPath('data.invoice_number', "INV-{$year}-000001");
});

it('seals the rate card version the moment an invoice cites it', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard();

    expect($version->fresh()->isLocked())->toBeFalse();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    generateInvoice($finance, $trip, 'idem-seals-version1')->assertStatus(201);

    // AGENTS.md: "Rate cards are versioned and immutable once used."
    expect($version->fresh()->isLocked())->toBeTrue();
});

it('refuses every attempt to edit or delete an issued invoice', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    generateInvoice($finance, $trip, 'idem-immutable-0001')->assertStatus(201);

    $invoice = Invoice::where('trip_id', $trip->id)->firstOrFail();
    $line = $invoice->lines->first();

    // AGENTS.md: corrections are credit notes, "never silent edits to
    // issued invoices". There is no HTTP route that tries this — the point
    // is that the model refuses even when called directly, so a future
    // service cannot quietly acquire the ability.
    expect(fn () => $invoice->update(['total_minor' => 1]))
        ->toThrow(FinancialRecordImmutableException::class);
    expect(fn () => $invoice->delete())
        ->toThrow(FinancialRecordImmutableException::class);
    expect(fn () => $line->update(['amount_minor' => 1]))
        ->toThrow(FinancialRecordImmutableException::class);
    expect(fn () => $line->delete())
        ->toThrow(FinancialRecordImmutableException::class);

    expect(Shillings::toMinor($invoice->fresh()->total()))->toBe(26_000);
    expect(InvoiceLine::where('invoice_id', $invoice->id)->count())->toBe($invoice->lines->count());
});

it('records the issued invoice in the tenant-visible audit log', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    generateInvoice($finance, $trip, 'idem-audited-00001')->assertStatus(201);

    $invoice = Invoice::where('trip_id', $trip->id)->firstOrFail();

    // AGENTS.md Observability: every mutation to invoices is audited, and
    // "Demonstrated in every bank presentation."
    $entry = AuditLog::where('auditable_type', 'invoice')
        ->where('auditable_id', $invoice->id)
        ->where('action', 'created')
        ->first();

    expect($entry)->not->toBeNull();
    expect($entry->tenant_id)->toBe($tenant->id);
    expect($entry->user_id)->toBe($finance->id);
});

it('bills a back-dated trip under the version in force when it ran', function () {
    $this->travelTo(Carbon::parse('2026-02-01 09:00:00', 'UTC'));

    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    // Prices double from June, and the trip is only invoiced in July.
    app(RateCardService::class)->addVersion($card, [
        'effective_from' => '2026-06-01',
        'rates' => [[
            'vehicle_category' => 'sedan',
            'base_fare_minor' => 10_000,
            'per_km_minor' => 1_000,
            'minimum_charge_minor' => 0,
        ]],
    ], $finance);

    $this->travelTo(Carbon::parse('2026-07-05 09:00:00', 'UTC'));

    // Still 26,000: the February prices, because that is when the journey
    // happened. Billing it at July's rates is the dispute AGENTS.md's
    // versioning rule exists to prevent.
    generateInvoice($finance, $trip, 'idem-backdated-00001')
        ->assertStatus(201)
        ->assertJsonPath('data.total_minor', 26_000)
        ->assertJsonPath('data.rate_card_version_id', $card->versions()->reorder()->orderBy('version')->first()->id);
});
