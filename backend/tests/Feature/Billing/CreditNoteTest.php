<?php

use App\Enums\UserRole;
use App\Exceptions\FinancialRecordImmutableException;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Money\Shillings;
use Illuminate\Testing\TestResponse;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\Invoice;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * @return array{invoice: Invoice, finance: User, tenant: Tenant, trip: Trip}
 */
function invoicedTrip(): array
{
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    test()->withHeader('Idempotency-Key', 'idem-invoice-for-cn')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice")
        ->assertStatus(201);

    return [
        'invoice' => Invoice::where('trip_id', $trip->id)->firstOrFail(),
        'finance' => $finance,
        'tenant' => $tenant,
        'trip' => $trip,
    ];
}

function issueCreditNote(User $actor, Invoice $invoice, string $key, array $body): TestResponse
{
    return test()
        ->withHeader('Idempotency-Key', $key)
        ->actingAs($actor, 'sanctum')
        ->postJson("/api/v1/invoices/{$invoice->uuid}/credit-notes", $body);
}

it('credits part of an invoice and reduces the balance without touching the invoice', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    $response = issueCreditNote($finance, $invoice, 'idem-credit-part-01', [
        'reason' => 'Client disputed 10 km of the route; agreed to reduce.',
        'lines' => [[
            'description' => 'Distance correction',
            'amount_minor' => 5_000,
            'invoice_line_id' => $invoice->lines->firstWhere('type', 'distance')->id,
        ]],
    ]);

    $response->assertStatus(201)
        ->assertJsonPath('data.credit_note_number', 'CRN-'.now()->format('Y').'-000001')
        ->assertJsonPath('data.total_minor', 5_000);

    // AGENTS.md: corrections "never silent edits to issued invoices". The
    // invoice still says 26,000 — what changed is the balance, derived from
    // the credit notes.
    $fresh = $invoice->fresh()->load('creditNotes');
    expect(Shillings::toMinor($fresh->total()))->toBe(26_000);
    expect(Shillings::toMinor($fresh->creditedTotal()))->toBe(5_000);
    expect(Shillings::toMinor($fresh->balance()))->toBe(21_000);
});

it('accumulates several credit notes against one invoice', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    foreach ([['idem-credit-multi-1', 4_000], ['idem-credit-multi-2', 6_000]] as [$key, $amount]) {
        issueCreditNote($finance, $invoice, $key, [
            'reason' => 'Negotiated settlement instalment.',
            'lines' => [['description' => 'Settlement', 'amount_minor' => $amount]],
        ])->assertStatus(201);
    }

    $fresh = $invoice->fresh()->load('creditNotes');
    expect(Shillings::toMinor($fresh->creditedTotal()))->toBe(10_000);
    expect(Shillings::toMinor($fresh->balance()))->toBe(16_000);
    expect(CreditNote::where('invoice_id', $invoice->id)->count())->toBe(2);
});

it('refuses a single credit note larger than the invoice', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    issueCreditNote($finance, $invoice, 'idem-credit-toobig1', [
        'reason' => 'Fat-fingered amount.',
        'lines' => [['description' => 'Oversized credit', 'amount_minor' => 26_001]],
    ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'CREDIT_NOTE_EXCEEDS_INVOICE');

    expect(CreditNote::count())->toBe(0);
});

it('refuses the credit note that would tip the running total past the invoice', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    // Three plausible notes, none oversized on its own. The realistic way
    // an invoice ends up over-credited is a sequence like this, which is
    // why the invariant is on the running total and is checked under the
    // invoice's row lock rather than per note.
    issueCreditNote($finance, $invoice, 'idem-credit-run-001', [
        'reason' => 'First adjustment.',
        'lines' => [['description' => 'Adjustment 1', 'amount_minor' => 20_000]],
    ])->assertStatus(201);

    issueCreditNote($finance, $invoice, 'idem-credit-run-002', [
        'reason' => 'Second adjustment.',
        'lines' => [['description' => 'Adjustment 2', 'amount_minor' => 5_000]],
    ])->assertStatus(201);

    // 20,000 + 5,000 + 2,000 = 27,000 against a 26,000 invoice.
    issueCreditNote($finance, $invoice, 'idem-credit-run-003', [
        'reason' => 'Third adjustment.',
        'lines' => [['description' => 'Adjustment 3', 'amount_minor' => 2_000]],
    ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'CREDIT_NOTE_EXCEEDS_INVOICE');

    $fresh = $invoice->fresh()->load('creditNotes');
    expect(Shillings::toMinor($fresh->creditedTotal()))->toBe(25_000);
    expect(Shillings::toMinor($fresh->balance()))->toBe(1_000);
});

it('allows crediting an invoice down to exactly zero', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    // The boundary is inclusive: a fully credited invoice is a normal
    // outcome (the trip was billed in error), an over-credited one is not.
    issueCreditNote($finance, $invoice, 'idem-credit-full-01', [
        'reason' => 'Trip billed in error; credited in full.',
        'lines' => [['description' => 'Full credit', 'amount_minor' => 26_000]],
    ])->assertStatus(201);

    expect(Shillings::toMinor($invoice->fresh()->load('creditNotes')->balance()))->toBe(0);
});

it('returns the original credit note on a replay of the same idempotency key', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    $body = [
        'reason' => 'Client disputed the waiting charge.',
        'lines' => [['description' => 'Waiting correction', 'amount_minor' => 3_000]],
    ];

    $first = issueCreditNote($finance, $invoice, 'idem-credit-replay1', $body)->assertStatus(201);
    $second = issueCreditNote($finance, $invoice, 'idem-credit-replay1', $body)->assertStatus(200);

    expect($second->json('data.uuid'))->toBe($first->json('data.uuid'));
    expect(CreditNote::count())->toBe(1);
    expect(Shillings::toMinor($invoice->fresh()->load('creditNotes')->creditedTotal()))->toBe(3_000);
});

it('requires a stated reason', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    // A credit note without a reason is exactly the audit finding this
    // table exists to prevent.
    issueCreditNote($finance, $invoice, 'idem-credit-noreason', [
        'lines' => [['description' => 'Mystery credit', 'amount_minor' => 1_000]],
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');

    expect(CreditNote::count())->toBe(0);
});

it('refuses a credit line attributed to another invoice\'s line', function () {
    ['invoice' => $invoice, 'finance' => $finance, 'tenant' => $tenant] = invoicedTrip();

    // A second invoice in the same tenant, so this is purely about the line
    // belonging to *this* invoice — the cross-tenant case is
    // BillingCrossTenantIsolationTest's job.
    $vehicle = Vehicle::factory()->create(['category' => 'sedan']);
    $driver = Driver::factory()->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    $otherTrip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);
    $this->withHeader('Idempotency-Key', 'idem-second-invoice')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$otherTrip->id}/invoice")->assertStatus(201);

    $foreignLine = Invoice::where('trip_id', $otherTrip->id)->firstOrFail()->lines->first();

    issueCreditNote($finance, $invoice, 'idem-credit-wrongln', [
        'reason' => 'Attributed to the wrong invoice.',
        'lines' => [[
            'description' => 'Misattributed',
            'amount_minor' => 1_000,
            'invoice_line_id' => $foreignLine->id,
        ]],
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('lines.0.invoice_line_id');
});

it('refuses every attempt to edit or delete an issued credit note', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    issueCreditNote($finance, $invoice, 'idem-credit-frozen1', [
        'reason' => 'Agreed reduction.',
        'lines' => [['description' => 'Reduction', 'amount_minor' => 2_000]],
    ])->assertStatus(201);

    $note = CreditNote::firstOrFail();

    // A credit note issued in error is not corrected by editing it. It
    // stands, and the record shows both — which is the property an auditor
    // is actually checking for.
    expect(fn () => $note->update(['total_minor' => 1]))
        ->toThrow(FinancialRecordImmutableException::class);
    expect(fn () => $note->delete())
        ->toThrow(FinancialRecordImmutableException::class);
    expect(fn () => $note->lines->first()->update(['amount_minor' => 1]))
        ->toThrow(FinancialRecordImmutableException::class);

    expect(Shillings::toMinor($note->fresh()->total()))->toBe(2_000);
});

it('numbers credit notes in their own series, independent of invoices', function () {
    ['invoice' => $invoice, 'finance' => $finance] = invoicedTrip();

    issueCreditNote($finance, $invoice, 'idem-credit-series1', [
        'reason' => 'First.', 'lines' => [['description' => 'One', 'amount_minor' => 1_000]],
    ])->assertJsonPath('data.credit_note_number', 'CRN-'.now()->format('Y').'-000001');

    issueCreditNote($finance, $invoice, 'idem-credit-series2', [
        'reason' => 'Second.', 'lines' => [['description' => 'Two', 'amount_minor' => 1_000]],
    ])->assertJsonPath('data.credit_note_number', 'CRN-'.now()->format('Y').'-000002');

    // Issuing credit notes must never advance the invoice sequence — a
    // skipped invoice number reads as a deleted invoice to an auditor.
    expect(DB::table('document_number_sequences')
        ->where('document_type', 'invoice')->value('next_number'))->toBe(2);
});

it('records the credit note in the tenant-visible audit log', function () {
    ['invoice' => $invoice, 'finance' => $finance, 'tenant' => $tenant] = invoicedTrip();

    issueCreditNote($finance, $invoice, 'idem-credit-audited', [
        'reason' => 'Agreed reduction.',
        'lines' => [['description' => 'Reduction', 'amount_minor' => 2_000]],
    ])->assertStatus(201);

    $note = CreditNote::firstOrFail();
    $entry = AuditLog::where('auditable_type', 'credit_note')
        ->where('auditable_id', $note->id)
        ->where('action', 'created')
        ->first();

    expect($entry)->not->toBeNull();
    expect($entry->tenant_id)->toBe($tenant->id);
    expect($entry->user_id)->toBe($finance->id);
});
