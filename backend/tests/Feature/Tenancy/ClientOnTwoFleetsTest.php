<?php

use App\Models\Operator;
use App\Models\OperatorClient;
use Illuminate\Database\QueryException;
use Modules\Billing\Enums\DocumentType;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Pricing\RateCardResolver;
use Modules\Billing\Repositories\DocumentNumberSequenceRepository;
use Modules\Billing\Services\InvoiceService;
use Modules\Billing\Services\RateCardService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * One client, two fleets, two unbroken invoice series (ADR-0055 §6, F2).
 *
 * This is the change with the most at stake in the whole fleet model.
 * `document_number_sequences` was keyed `unique(tenant_id, document_type,
 * year)` — one counter per client — so the moment a client contracts a second
 * fleet, both fleets draw from it and Centenary Bank's 2026 series comes back
 * 1, 3, 4, 7 with the gaps sitting in a competitor's ledger.
 *
 * `PRODUCT.md` sells audit-grade correctness to a bank. An auditor asking about
 * the gaps would be told, truthfully, that another company holds them.
 *
 * As everywhere in this effort, the rival fleet exists only in tests.
 */
beforeEach(function () {
    $this->rival = Operator::create([
        'name' => 'Rival Transport Ltd',
        'slug' => 'rival-transport',
        'status' => 'active',
    ]);
});

it('gives two fleets billing one client their own unbroken series', function () {
    $sequences = app(DocumentNumberSequenceRepository::class);
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    $sequences->ensureSeries(Operator::SHANITAH, $tenant->id, DocumentType::INVOICE, 2026);
    $sequences->ensureSeries($this->rival->id, $tenant->id, DocumentType::INVOICE, 2026);

    $shanitah = DB::transaction(fn () => [
        $sequences->allocate(Operator::SHANITAH, $tenant->id, DocumentType::INVOICE, 2026),
        $sequences->allocate(Operator::SHANITAH, $tenant->id, DocumentType::INVOICE, 2026),
    ]);

    $rival = DB::transaction(fn () => [
        $sequences->allocate($this->rival->id, $tenant->id, DocumentType::INVOICE, 2026),
        $sequences->allocate($this->rival->id, $tenant->id, DocumentType::INVOICE, 2026),
    ]);

    // Each fleet's own series runs 1, 2 — not 1, 2 and 3, 4 out of one pool.
    // Asserted as exact sequences rather than "no duplicates", because the
    // failure being guarded is a *gap* in one company's ledger, and a
    // uniqueness check passes happily through gaps.
    expect($shanitah)->toBe([1, 2])
        ->and($rival)->toBe([1, 2]);
});

it('keeps the two counters as separate rows, which is what the key now allows', function () {
    $sequences = app(DocumentNumberSequenceRepository::class);
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    $sequences->ensureSeries(Operator::SHANITAH, $tenant->id, DocumentType::INVOICE, 2026);
    $sequences->ensureSeries($this->rival->id, $tenant->id, DocumentType::INVOICE, 2026);

    expect(DB::table('document_number_sequences')
        ->where('tenant_id', $tenant->id)
        ->where('document_type', DocumentType::INVOICE->value)
        ->where('year', 2026)
        ->count())->toBe(2);
});

it('records the fleet whose driver ran the trip, not the fleet of whoever assigned it', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher] = BillingFixtures::tenantWithRateCard();

    // The driver belongs to the rival; the dispatcher creating the trip is
    // Shanitah's. The trip is the rival's work.
    $driver = Driver::factory()->create(['operator_id' => $this->rival->id]);
    $vehicle = Vehicle::factory()->create(['operator_id' => $this->rival->id, 'category' => 'sedan']);

    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $dispatcher);

    // Taken from the driver rather than the actor or the request context: a
    // dispatcher may belong to a different fleet once Kangaru can act as one
    // (ADR-0056), and this path also runs from the scheduler with no request
    // at all.
    expect($trip->operator_id)->toBe($this->rival->id);
});

it('bills a trip into the series of the fleet that ran it', function () {
    [
        'tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver,
    ] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    $trip->forceFill(['operator_id' => $this->rival->id])->save();

    $invoice = app(InvoiceService::class)
        ->generateForTrip($trip->fresh(), 'idem-'.$trip->id, $finance);

    expect($invoice->operator_id)->toBe($this->rival->id)
        ->and(DB::table('document_number_sequences')
            ->where('operator_id', $this->rival->id)
            ->where('tenant_id', $tenant->id)
            ->exists())->toBeTrue();
});

it('refuses to invoice a corporate trip that names no fleet', function () {
    [
        'tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver,
    ] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    Trip::withoutEvents(fn () => $trip->forceFill(['operator_id' => null])->save());

    // A row F0 backfilled and nothing has since stamped. Guessing a fleet
    // would put the number in one ledger and the work in another, so the
    // honest answer is to refuse.
    expect(fn () => app(InvoiceService::class)
        ->generateForTrip($trip->fresh(), 'idem-none-'.$trip->id, $finance))
        ->toThrow(RuntimeException::class, 'names no fleet');
});

/* ------------------------------------------------- the contract itself --- */

it('lets one client be served by two fleets at once', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    OperatorClient::create(['operator_id' => Operator::SHANITAH, 'tenant_id' => $tenant->id]);
    OperatorClient::create(['operator_id' => $this->rival->id, 'tenant_id' => $tenant->id]);

    // The decision the owner made twice, now expressible. Before this table
    // there was nowhere to store the answer at all.
    expect($tenant->contracts()->count())->toBe(2)
        ->and(OperatorClient::serving($tenant->id)->pluck('operator_id')->sort()->values()->all())
        ->toBe([Operator::SHANITAH, $this->rival->id]);
});

it('refuses a second contract between the same fleet and client', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    OperatorClient::create(['operator_id' => Operator::SHANITAH, 'tenant_id' => $tenant->id]);

    // Ending and restarting a relationship is `status` and the dates, not a
    // second row — otherwise "which contract prices this trip" has more than
    // one answer, and nothing in the schema says which.
    expect(fn () => OperatorClient::create([
        'operator_id' => Operator::SHANITAH,
        'tenant_id' => $tenant->id,
    ]))->toThrow(QueryException::class);
});

it('keeps an ended contract on the record, because its history is the client s', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    OperatorClient::create(['operator_id' => Operator::SHANITAH, 'tenant_id' => $tenant->id]);
    OperatorClient::create([
        'operator_id' => $this->rival->id,
        'tenant_id' => $tenant->id,
        'status' => 'ended',
        'ended_on' => '2026-06-30',
    ]);

    // `serving()` is who may take new work; `contracts()` is everyone who ever
    // did. A trip run last March still belongs to the fleet that ran it, and
    // hiding them would attribute a year of the client's own history to nobody.
    expect(OperatorClient::serving($tenant->id)->count())->toBe(1)
        ->and($tenant->contracts()->count())->toBe(2);
});

it('treats a null override as the client s own value, not as missing data', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    $contract = OperatorClient::create([
        'operator_id' => Operator::SHANITAH,
        'tenant_id' => $tenant->id,
    ]);

    // The F1 pattern one level in: null means inherit, a value means override.
    // `companies` keeps the client-level default because these fields are
    // inert and exposed on the API contract; overriding costs nothing and
    // dropping them would cost the frontend and openapi.yaml.
    expect($contract->billing_email)->toBeNull()
        ->and($contract->credit_limit_minor)->toBeNull()
        ->and($contract->status)->toBe(OperatorClient::ACTIVE);
});

it('refuses to price a trip on a fleet s card that is not the fleet that ran it', function () {
    [
        'tenant' => $tenant, 'card' => $shanitahCard, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver,
    ] = BillingFixtures::tenantWithRateCard();

    // The client has exactly one default card, and it is **Shanitah's**.
    $shanitahCard->forceFill(['operator_id' => Operator::SHANITAH])->save();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    $trip->forceFill(['operator_id' => $this->rival->id])->save();

    // Asserted as a **refusal**, not as "picks the right one of two".
    //
    // The first version of this test set up two cards and asserted the rival's
    // was chosen — and it passed with the fleet filter removed, twice, because
    // `first()` happened to return that row anyway. It was green and it proved
    // nothing; only the mutation showed it.
    //
    // A refusal cannot pass by luck: with no filter, Shanitah's card resolves
    // and the trip is billed at another fleet's negotiated rate on an invoice
    // that looks entirely ordinary. With the filter there is nothing to
    // resolve, and pricing says so.
    expect(fn () => app(RateCardResolver::class)->resolveFor($trip->fresh()))
        ->toThrow(RateCardNotConfiguredException::class);
});

it('prices a trip on the card belonging to the fleet that ran it', function () {
    [
        'tenant' => $tenant, 'finance' => $finance, 'card' => $shanitahCard,
        'dispatcher' => $dispatcher, 'vehicle' => $vehicle, 'driver' => $driver,
    ] = BillingFixtures::tenantWithRateCard();

    $shanitahCard->forceFill(['operator_id' => Operator::SHANITAH])->save();

    $rivalCard = RateCard::query()->create([
        'tenant_id' => $tenant->id,
        'operator_id' => $this->rival->id,
        'name' => 'Rival terms',
        'status' => 'active',
        'is_default' => true,
    ]);
    app(RateCardService::class)->addVersion($rivalCard, [
        'effective_from' => '2020-01-01',
        'rounding_mode' => 'half_up',
        'free_waiting_minutes' => 10,
        'night_starts_at' => null,
        'night_ends_at' => null,
        'night_multiplier_bp' => RateCardVersion::NO_MULTIPLIER_BP,
        'rates' => [[
            'vehicle_category' => 'sedan',
            'base_fare_minor' => 9_999,
            'per_km_minor' => 999,
            'per_waiting_minute_minor' => 200,
            'minimum_charge_minor' => 10_000,
            'maximum_charge_minor' => null,
        ]],
    ], $finance);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    $trip->forceFill(['operator_id' => $this->rival->id])->save();

    expect(app(RateCardResolver::class)->resolveFor($trip->fresh())->rate_card_id)
        ->toBe($rivalCard->id);
});
