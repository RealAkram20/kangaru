<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Services\CreditNoteService;
use Modules\Billing\Services\InvoiceService;
use Modules\Reports\Models\ReportExport;
use Tests\Support\BillingFixtures;

/**
 * The financial report — PROJECT.md's fourth Phase 1 report.
 *
 * Every figure asserted here comes from an invoice raised by InvoiceService
 * against a trip walked through the real state machine, never from a row
 * written straight to `invoices`. An invoice inserted directly would carry
 * a total no rate card produced and a number the locked counter never
 * allocated — it would prove nothing about a report whose whole job is to
 * total what billing actually issued.
 */

/**
 * A tenant with two completed, invoiced trips and a credit note against
 * the first.
 *
 * Distances are chosen so the totals are checkable by hand against
 * BillingFixtures' default prices (base 5,000 + 500/km, minimum 10,000):
 *   - 40 km -> 5,000 + 20,000 = 25,000
 *   - 10 km -> 5,000 +  5,000 = 10,000
 * Total invoiced 35,000; credited 4,000; outstanding 31,000.
 *
 * @return array<string, mixed>
 */
function financialFixture(string $issuedAt = '2026-07-10 09:00:00'): array
{
    ['tenant' => $tenant, 'finance' => $finance, 'vehicle' => $vehicle, 'driver' => $driver]
        = BillingFixtures::tenantWithRateCard();

    $invoices = [];

    foreach ([['km' => 40, 'key' => 'fin-a'], ['km' => 10, 'key' => 'fin-b']] as $spec) {
        $trip = BillingFixtures::completedTrip(
            $tenant,
            $finance,
            $vehicle,
            $driver,
            odometerStart: 15_000,
            odometerEnd: 15_000 + $spec['km'],
        );

        $invoices[] = app(InvoiceService::class)->generateForTrip($trip, $spec['key'], $finance);
    }

    // Both invoices are stamped into the same period. `issued_at` is set by
    // the service to now(), and the report buckets on it — so the test
    // controls it explicitly rather than depending on the wall clock, which
    // would put a run on 1 August into a different month from the
    // assertions and make this suite fail once a month.
    //
    // toBase(), not getQuery(): both bypass Invoice's refusal to be updated
    // (which is the point — nothing in production may do this), but only
    // toBase() applies TenantScope. getQuery() would restamp every tenant's
    // invoices, which would quietly defeat the isolation test below.
    Invoice::query()->toBase()->update(['issued_at' => $issuedAt]);

    return compact('tenant', 'finance', 'vehicle', 'driver', 'invoices');
}

/**
 * Moves a credit note to a chosen instant, the same way and for the same
 * reason as the invoices above.
 */
function stampCreditNote(CreditNote $note, string $issuedAt): void
{
    CreditNote::query()->whereKey($note->id)->toBase()->update(['issued_at' => $issuedAt]);
}

it('totals invoiced, credited and outstanding for the period', function () {
    ['finance' => $finance, 'invoices' => $invoices] = financialFixture();

    $note = app(CreditNoteService::class)->issue(
        $invoices[0],
        [['description' => 'Goodwill', 'amount_minor' => 4_000]],
        'Agreed goodwill adjustment.',
        'fin-credit-a',
        $finance,
    );

    // Into the same month as the invoices it corrects, so this case is
    // about the totals rather than about the period a note lands in —
    // that is the next test's job.
    stampCreditNote($note, '2026-07-12 10:00:00');

    $response = $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial?from=2026-07-01&to=2026-07-31')
        ->assertOk();

    expect($response->json('data'))->toHaveCount(1);

    // Period, invoices, invoiced, credit notes, credited, net.
    expect($response->json('data.0.0'))->toBe('Jul 2026');
    expect($response->json('data.0.1'))->toBe(2);
    expect($response->json('data.0.2'))->toBe(35_000);
    expect($response->json('data.0.3'))->toBe(1);
    expect($response->json('data.0.4'))->toBe(4_000);
    expect($response->json('data.0.5'))->toBe(31_000);

    expect($response->json('meta.summary.invoiced_minor'))->toBe(35_000);
    expect($response->json('meta.summary.credited_minor'))->toBe(4_000);
    expect($response->json('meta.summary.outstanding_minor'))->toBe(31_000);
    expect($response->json('meta.summary.currency'))->toBe('UGX');

    // Headers travel with the rows, so no client keeps its own column list.
    expect($response->json('meta.headers.2'))->toBe('Invoiced (UGX)');
});

it('states that outstanding does not account for payments', function () {
    ['finance' => $finance] = financialFixture();

    // Nothing in the platform records money coming in (Modules/Billing
    // README, deferred item 1), so "outstanding" here can only mean issued
    // less credited. A bank reading it as "unpaid" would be reading a
    // number this system cannot produce, and the caveat has to be in the
    // payload rather than only in a tooltip.
    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial')
        ->assertOk()
        ->assertJsonPath('meta.summary.payments_recorded', false);
});

it('books a credit note into the period it was issued, not the invoice\'s', function () {
    ['finance' => $finance, 'invoices' => $invoices] = financialFixture('2026-07-10 09:00:00');

    $note = app(CreditNoteService::class)->issue(
        $invoices[0],
        [['description' => 'Correction', 'amount_minor' => 5_000]],
        'Corrected after month close.',
        'fin-credit-late',
        $finance,
    );

    // Raised in August against a July invoice. That is when the ledger
    // moved and when a finance user reconciling August will look for it.
    stampCreditNote($note, '2026-08-03 11:00:00');

    $response = $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial?from=2026-07-01&to=2026-08-31')
        ->assertOk();

    expect($response->json('data'))->toHaveCount(2);

    // July: invoiced 35,000, nothing credited.
    expect($response->json('data.0.0'))->toBe('Jul 2026');
    expect($response->json('data.0.2'))->toBe(35_000);
    expect($response->json('data.0.4'))->toBe(0);

    // August: nothing invoiced, 5,000 credited — so the period's net is
    // negative, and is not clamped. A month that only corrected earlier
    // work really did reduce receivables.
    expect($response->json('data.1.0'))->toBe('Aug 2026');
    expect($response->json('data.1.1'))->toBe(0);
    expect($response->json('data.1.2'))->toBe(0);
    expect($response->json('data.1.4'))->toBe(5_000);
    expect($response->json('data.1.5'))->toBe(-5_000);

    // Across both, outstanding is still the whole range's issued less
    // credited — the split into periods must not change the total.
    expect($response->json('meta.summary.outstanding_minor'))->toBe(30_000);
});

it('groups by day, week and year as well as month', function () {
    ['finance' => $finance] = financialFixture('2026-07-15 09:00:00');

    $expected = [
        'day' => '15 Jul 2026',
        // 15 July 2026 is a Wednesday; the week is keyed by its Monday.
        'week' => 'Week of 13 Jul 2026',
        'month' => 'Jul 2026',
        'year' => '2026',
    ];

    foreach ($expected as $groupBy => $label) {
        $response = $this->actingAs($finance, 'sanctum')
            ->getJson("/api/v1/reports/financial?group_by={$groupBy}")
            ->assertOk();

        expect($response->json('data.0.0'))->toBe($label);
        // However it is cut, the money is the same money.
        expect($response->json('meta.summary.invoiced_minor'))->toBe(35_000);
        expect($response->json('meta.period'))->toContain("by {$groupBy}");
    }
});

it('includes documents issued on the closing day of the range', function () {
    ['finance' => $finance] = financialFixture('2026-07-31 16:20:00');

    // A bare `to` covers the whole of that day. Month-end is when invoices
    // are raised, so a bound that stopped at 00:00:00 would drop the
    // busiest day in the range.
    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial?from=2026-07-01&to=2026-07-31')
        ->assertOk()
        ->assertJsonPath('meta.summary.invoiced_minor', 35_000);
});

it('reports nothing rather than zero rows of nothing when the range is empty', function () {
    ['finance' => $finance] = financialFixture('2026-07-10 09:00:00');

    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial?from=2030-01-01&to=2030-12-31')
        ->assertOk()
        ->assertJsonCount(0, 'data')
        ->assertJsonPath('meta.summary.invoiced_minor', 0)
        ->assertJsonPath('meta.summary.outstanding_minor', 0)
        ->assertJsonPath('meta.summary.periods', 0);
});

it('rejects a filter this report cannot honour', function () {
    ['finance' => $finance] = financialFixture();

    // `driver_id` is a trip-report filter. Accepting it here and quietly
    // ignoring it would produce a document reporting the whole tenant's
    // billing while the request said one driver's.
    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial?driver_id=1')
        ->assertStatus(422)
        ->assertJsonValidationErrors('driver_id');

    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/reports/financial?group_by=fortnight')
        ->assertStatus(422)
        ->assertJsonValidationErrors('group_by');
});

it('forbids roles that should not see the tenant\'s billing totals', function () {
    ['tenant' => $tenant] = financialFixture();

    $driverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);
    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    foreach ([$driverUser, $employee] as $user) {
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/reports/financial')->assertForbidden();
    }
});

it('never totals another tenant\'s money into this one', function () {
    ['finance' => $financeA] = financialFixture();

    // A second tenant billing the same amounts. A leak here would not show
    // up as a stray row — both tenants bucket into July, so it would show
    // up as 70,000 where 35,000 is correct. ADR-0001 calls a cross-tenant
    // leak the worst bug this platform can have, and on money it is
    // invisible unless the total itself is asserted.
    financialFixture();

    $this->actingAs($financeA, 'sanctum')
        ->getJson('/api/v1/reports/financial?from=2026-07-01&to=2026-07-31')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.1', 2)
        ->assertJsonPath('data.0.2', 35_000)
        ->assertJsonPath('meta.summary.invoiced_minor', 35_000)
        ->assertJsonPath('meta.summary.outstanding_minor', 35_000);
});

it('exports the financial report in every format', function () {
    Storage::fake('local');
    ['finance' => $finance] = financialFixture('2026-07-10 09:00:00');

    foreach (['csv', 'xlsx', 'pdf'] as $format) {
        $this->actingAs($finance, 'sanctum')
            ->postJson('/api/v1/reports/exports', [
                'report' => 'financial',
                'format' => $format,
                'group_by' => 'month',
            ])
            ->assertStatus(202);

        $export = ReportExport::latest('id')->firstOrFail();

        expect($export->report->value)->toBe('financial');
        // One period, so one row — the export and the screen agree because
        // both come from the same ReportSource.
        expect($export->row_count)->toBe(1);
        expect($export->path)->toContain('kangaruride-financial-report-');
        expect($export->filters['group_by'])->toBe('month');
        Storage::assertExists($export->path);
    }
});

it('writes the money into the file, not just onto the screen', function () {
    Storage::fake('local');
    ['finance' => $finance] = financialFixture('2026-07-10 09:00:00');

    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'financial', 'format' => 'csv'])
        ->assertStatus(202);

    $csv = Storage::get(ReportExport::latest('id')->firstOrFail()->path);

    expect($csv)->toContain('Invoiced (UGX)');
    expect($csv)->toContain('Jul 2026');
    // The figure itself, unformatted — this column is summed in a
    // spreadsheet, and "UGX 35,000" in a cell is a value nobody can add up.
    expect($csv)->toContain('35000');
});

it('refuses an export filter the chosen report cannot honour', function () {
    ['finance' => $finance] = financialFixture();

    // Pre-existing gap this pass closes: the export endpoint stands in for
    // every report, so its rules are the union of all their filters. Without
    // a per-report check it accepted this and dropped it, producing a file
    // that did not match the request that asked for it.
    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/reports/exports', [
            'report' => 'financial',
            'format' => 'csv',
            'driver_id' => 1,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('driver_id');

    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/reports/exports', [
            'report' => 'drivers',
            'format' => 'csv',
            'group_by' => 'month',
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('group_by');
});
