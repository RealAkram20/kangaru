<?php

use Modules\Billing\Enums\DocumentType;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Repositories\DocumentNumberSequenceRepository;
use Modules\Billing\Services\RateCardService;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * The parts of the module's surface the correctness suites do not reach on
 * their way past: listing and filtering, the explicitly-named rate card,
 * and the refusals that only fire when a caller gets something subtly
 * wrong.
 *
 * These matter less than the arithmetic, but an untested 422 path is still
 * a path that can start returning 500 without anybody noticing.
 */

/**
 * @return array<string, mixed>
 */
function billedFixture(string $key = 'idem-api-fixture-01'): array
{
    $fixture = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip(
        $fixture['tenant'], $fixture['dispatcher'], $fixture['vehicle'], $fixture['driver'], 15_000, 15_042,
    );

    test()->withHeader('Idempotency-Key', $key)
        ->actingAs($fixture['finance'], 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice")
        ->assertStatus(201);

    return [...$fixture, 'trip' => $trip, 'invoice' => Invoice::where('trip_id', $trip->id)->firstOrFail()];
}

it('lists invoices with their lines and a cursor', function () {
    ['finance' => $finance, 'invoice' => $invoice] = billedFixture();

    $this->actingAs($finance, 'sanctum')->getJson('/api/v1/invoices')
        ->assertOk()
        ->assertJsonPath('data.0.invoice_number', $invoice->invoice_number)
        ->assertJsonPath('data.0.lines.0.type', 'base_fare')
        ->assertJsonPath('data.0.lines.0.type_label', 'Base fare')
        // The line id is served so a credit note can name the line it
        // corrects; StoreCreditNoteRequest validates against exactly this.
        ->assertJsonPath('data.0.lines.0.id', $invoice->lines->first()->id)
        // Invoices are append-only and grow without bound, so the list is
        // cursor-paginated per AGENTS.md rather than page-paginated.
        ->assertJsonStructure(['meta' => ['cursor' => ['next']]]);
});

it('filters the invoice list by the whitelisted params', function () {
    ['finance' => $finance, 'invoice' => $invoice, 'trip' => $trip] = billedFixture();

    $this->actingAs($finance, 'sanctum')
        ->getJson("/api/v1/invoices?trip_id={$trip->id}")
        ->assertOk()
        ->assertJsonCount(1, 'data');

    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/invoices?invoice_number='.$invoice->invoice_number)
        ->assertOk()
        ->assertJsonCount(1, 'data');

    // A bare `to` date covers the whole of that day, matching the trip
    // report's convention — the two must agree or a finance user
    // reconciling one against the other sees a phantom discrepancy.
    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/invoices?from='.now()->toDateString().'&to='.now()->toDateString())
        ->assertOk()
        ->assertJsonCount(1, 'data');

    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/invoices?from=2030-01-01')
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('rejects an unknown filter rather than ignoring it', function () {
    ['finance' => $finance] = billedFixture();

    // AGENTS.md: "unknown filters return 422, not silence." A silently
    // ignored filter returns a wider set than the caller asked for, and on
    // an invoice list that is a number somebody will act on.
    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/invoices?tenant_id=2')
        ->assertStatus(422)
        ->assertJsonValidationErrors('tenant_id');

    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/invoices?from=2026-02-01&to=2026-01-01')
        ->assertStatus(422)
        ->assertJsonValidationErrors('to');
});

it('lists the credit notes raised against an invoice', function () {
    ['finance' => $finance, 'invoice' => $invoice] = billedFixture();

    $this->withHeader('Idempotency-Key', 'idem-api-creditnote1')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/invoices/{$invoice->uuid}/credit-notes", [
            'reason' => 'Agreed reduction after review.',
            'lines' => [[
                'description' => 'Distance correction',
                'amount_minor' => 2_500,
                'invoice_line_id' => $invoice->lines->firstWhere('type', 'distance')->id,
            ]],
        ])->assertStatus(201);

    $this->actingAs($finance, 'sanctum')
        ->getJson("/api/v1/invoices/{$invoice->uuid}/credit-notes")
        ->assertOk()
        ->assertJsonPath('data.0.total_minor', 2_500)
        ->assertJsonPath('data.0.reason', 'Agreed reduction after review.')
        ->assertJsonPath('data.0.lines.0.description', 'Distance correction');

    // And the invoice itself carries them, so a client rendering one
    // document does not need a second request to know the balance.
    $this->actingAs($finance, 'sanctum')
        ->getJson("/api/v1/invoices/{$invoice->uuid}")
        ->assertOk()
        ->assertJsonPath('data.credited_minor', 2_500)
        ->assertJsonPath('data.balance_minor', 23_500)
        ->assertJsonCount(1, 'data.credit_notes');
});

it('prices a trip with an explicitly named rate card instead of the default', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    // A second, non-default card — the shape a client-specific contract
    // takes before it is made the tenant default.
    $premium = app(RateCardService::class)->create([
        'name' => 'Premium contract',
        'is_default' => false,
        'version' => [
            'effective_from' => '2020-01-01',
            'rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 20_000,
                'per_km_minor' => 1_000, 'minimum_charge_minor' => 0]],
        ],
    ], $finance);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    // 20,000 + (1,000 x 42) = 62,000, against the default card's 26,000.
    $this->withHeader('Idempotency-Key', 'idem-api-named-card1')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice", ['rate_card_id' => $premium->id])
        ->assertStatus(201)
        ->assertJsonPath('data.total_minor', 62_000)
        ->assertJsonPath('data.rate_card_version_id', $premium->versions()->first()->id);
});

it('refuses to invoice a trip that predates every version of its rate card', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    // A card whose only version starts in 2030, made the default.
    $future = app(RateCardService::class)->create([
        'name' => 'Future prices',
        'is_default' => true,
        'version' => [
            'effective_from' => '2030-01-01',
            'rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 1_000]],
        ],
    ], $finance);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    // Nothing was in force when the trip ran. Guessing at a price — the
    // nearest version, say — is exactly what AGENTS.md's versioning rule
    // forbids, so this is a refusal that names the card to go and fix.
    $response = $this->withHeader('Idempotency-Key', 'idem-api-no-version1')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice")
        ->assertStatus(422)
        ->assertJsonPath('code', 'RATE_CARD_NOT_CONFIGURED');

    expect($response->json('message'))->toContain('Future prices');
    expect(Invoice::count())->toBe(0);
});

it('refuses to spend one credit note key across two invoices', function () {
    ['finance' => $finance, 'invoice' => $first, 'tenant' => $tenant,
        'dispatcher' => $dispatcher, 'driver' => $driver] = billedFixture('idem-api-cnkey-inv1');

    $secondTrip = BillingFixtures::completedTrip(
        $tenant, $dispatcher,
        Vehicle::factory()->forTenant($tenant)->create(['category' => 'sedan']),
        $driver,
    );
    $this->withHeader('Idempotency-Key', 'idem-api-cnkey-inv2')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$secondTrip->id}/invoice")->assertStatus(201);
    $second = Invoice::where('trip_id', $secondTrip->id)->firstOrFail();

    $body = ['reason' => 'Correction.', 'lines' => [['description' => 'Credit', 'amount_minor' => 1_000]]];

    $this->withHeader('Idempotency-Key', 'idem-api-shared-cnkey')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/invoices/{$first->uuid}/credit-notes", $body)
        ->assertStatus(201);

    // Handing back the first invoice's credit note would silently answer a
    // question about a different invoice.
    $this->withHeader('Idempotency-Key', 'idem-api-shared-cnkey')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/invoices/{$second->uuid}/credit-notes", $body)
        ->assertStatus(409)
        ->assertJsonPath('code', 'IDEMPOTENCY_KEY_REUSED');
});

it('refuses to allocate a document number outside a transaction', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    $sequences = app(DocumentNumberSequenceRepository::class);
    $sequences->ensureSeries($tenant->id, DocumentType::INVOICE, 2026);

    // lockForUpdate() outside a transaction is released immediately and
    // buys nothing, so a caller that forgets is told rather than silently
    // handed an unserialised counter. The same guard TripAssignmentGuard
    // carries, for the same reason.
    //
    // RefreshDatabase wraps this test in a transaction, so the guard is
    // exercised by unwrapping to level 0 first.
    DB::rollBack();

    try {
        expect(fn () => $sequences->lockSeries($tenant->id, DocumentType::INVOICE, 2026))
            ->toThrow(LogicException::class);
    } finally {
        // Hand RefreshDatabase back the transaction it expects to roll back.
        DB::beginTransaction();
    }
});

it('wires every billing relation to the right foreign key', function () {
    ['finance' => $finance, 'invoice' => $invoice, 'trip' => $trip,
        'tenant' => $tenant, 'card' => $card, 'version' => $version] = billedFixture('idem-api-relations1');

    $this->withHeader('Idempotency-Key', 'idem-api-relations-cn')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/invoices/{$invoice->uuid}/credit-notes", [
            'reason' => 'Relation fixture.',
            'lines' => [[
                'description' => 'Credit',
                'amount_minor' => 1_000,
                'invoice_line_id' => $invoice->lines->first()->id,
            ]],
        ])->assertStatus(201);

    // Traversed rather than merely declared. A relation pointing at the
    // wrong column — `issued_by_user_id` defaulting to `user_id`, say —
    // is silent until somebody opens an invoice and sees the wrong name
    // against it, and "who issued this?" is an audit question.
    expect($invoice->trip->is($trip))->toBeTrue();
    expect($invoice->rateCardVersion->is($version))->toBeTrue();
    expect($invoice->issuedBy->is($finance))->toBeTrue();
    expect($invoice->tenant->is($tenant))->toBeTrue();

    $line = $invoice->lines->first();
    expect($line->invoice->is($invoice))->toBeTrue();
    expect($line->rateCardVersion->is($version))->toBeTrue();

    $note = $invoice->creditNotes()->with('lines')->first();
    expect($note->invoice->is($invoice))->toBeTrue();
    expect($note->issuedBy->is($finance))->toBeTrue();
    expect($note->tenant->is($tenant))->toBeTrue();
    expect($note->lines->first()->creditNote->is($note))->toBeTrue();
    expect($note->lines->first()->invoiceLine->is($line))->toBeTrue();

    expect($card->tenant->is($tenant))->toBeTrue();
    expect($version->rateCard->is($card))->toBeTrue();
    expect($version->tenant->is($tenant))->toBeTrue();
    expect($version->createdBy->is($finance))->toBeTrue();
    expect($version->rates->first()->version->is($version))->toBeTrue();
});

it('refuses to allocate a number for a series that was never created', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    // ensureSeries() was never called for 2099. Inventing the row here
    // would mean allocating outside the insert-before-transaction ordering
    // that keeps two simultaneous first invoices from deadlocking.
    expect(fn () => app(DocumentNumberSequenceRepository::class)
        ->lockSeries($tenant->id, DocumentType::INVOICE, 2099))
        ->toThrow(RuntimeException::class);
});
