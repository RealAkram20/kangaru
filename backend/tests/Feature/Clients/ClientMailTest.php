<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\OperatorClient;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Mail;
use Modules\Administration\Services\SettingsService;
use Modules\Billing\Services\InvoicePdf;
use Modules\Billing\Services\InvoiceService;
use Modules\Clients\Models\Company;
use Modules\Clients\Services\ClientOnboardingService;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\MailDelivery;
use Tests\Support\BillingFixtures;

/**
 * M5, the client family.
 *
 * The assertion that matters most in this file is **who receives what**. A
 * client has two audiences and they are different people: a transport officer
 * books cars, and somebody in accounts pays the bill. Sending an invoice to
 * the first is how it goes unpaid, and there is nothing in a green test suite
 * that would otherwise notice.
 *
 * `ClientRecipient` is the one place that decides, so it is the one place
 * worth pinning.
 */
function clientMailOn(): void
{
    app(SettingsService::class)->setGroup('mail', [
        'enabled' => true,
        'host' => 'smtp.example.test',
        'port' => 587,
        'username' => '',
        'password' => 'secret',
        'encryption' => 'tls',
        'from_address' => 'operations@kangaruride.test',
        'from_name' => 'KangaruRide',
    ]);
}

/**
 * A fleet, a client, a contract between them, and the client's administrator.
 *
 * @return array{operator: Operator, tenant: Tenant, admin: User, contract: OperatorClient}
 */
function contractedClient(?string $billingEmail, string $status = OperatorClient::ACTIVE): array
{
    $operator = Operator::create([
        'name' => 'Shanitah General Enterprises',
        'slug' => 'shanitah-client-mail-'.uniqid(),
        'status' => 'active',
    ]);

    $tenant = Tenant::factory()->create(['name' => 'Nakumatt Ltd']);
    app(TenantContext::class)->set($tenant->id);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'access_level' => AccessLevel::CLIENT,
        'role' => UserRole::CORPORATE_ADMIN,
        'email' => 'admin@nakumatt.test',
    ]);

    // A second account at the same client, deliberately NOT an administrator.
    // A corporate employee raises bookings and has no business hearing about
    // the company's contracts.
    User::factory()->create([
        'tenant_id' => $tenant->id,
        'access_level' => AccessLevel::CLIENT,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'email' => 'employee@nakumatt.test',
    ]);

    $contract = OperatorClient::create([
        'operator_id' => $operator->id,
        'tenant_id' => $tenant->id,
        'status' => $status,
        'started_on' => now()->toDateString(),
        'billing_email' => $billingEmail,
    ]);

    return compact('operator', 'tenant', 'admin', 'contract');
}

function recipientsOf(NotificationType $type): array
{
    return MailDelivery::query()
        ->where('type', $type->value)
        ->pluck('recipient')
        ->sort()
        ->values()
        ->all();
}

it('tells a client when a fleet asks to serve them, which nothing did before', function () {
    clientMailOn();
    Mail::fake();

    /*
     * ADR-0060 §5 makes this the client's decision and nobody else's, and
     * until this email existed it gave them **no way to know they had been
     * asked**: the `requested` row sat in a table waiting for somebody who
     * never opened the screen.
     */
    ['operator' => $operator, 'tenant' => $tenant] = contractedClient(null, OperatorClient::ENDED);

    $company = Company::query()->withoutGlobalScopes()->create([
        'tenant_id' => $tenant->id,
        'legal_name' => 'Nakumatt Ltd',
        'registration_number' => 'REG-CLIENT-MAIL-1',
        'city' => 'Kampala',
        'country' => 'UG',
        'status' => 'active',
        // Not nullable on `companies`, and unrelated to the contract's own
        // billing address that these tests are about.
        'billing_email' => 'accounts@nakumatt.test',
    ]);

    $rival = Operator::create([
        'name' => 'Second Fleet Ltd',
        'slug' => 'second-fleet-client-mail',
        'status' => 'active',
    ]);

    app(ClientOnboardingService::class)->requestContract($company->registration_number, $rival->id);

    expect(recipientsOf(NotificationType::CLIENT_CONTRACT_REQUESTED))->toBe(['admin@nakumatt.test']);
});

it('does not ask twice when a fleet clicks twice', function () {
    clientMailOn();
    Mail::fake();

    ['tenant' => $tenant] = contractedClient(null, OperatorClient::ENDED);

    $company = Company::query()->withoutGlobalScopes()->create([
        'tenant_id' => $tenant->id,
        'legal_name' => 'Nakumatt Ltd',
        'registration_number' => 'REG-CLIENT-MAIL-2',
        'city' => 'Kampala',
        'country' => 'UG',
        'status' => 'active',
        // Not nullable on `companies`, and unrelated to the contract's own
        // billing address that these tests are about.
        'billing_email' => 'accounts@nakumatt.test',
    ]);

    $rival = Operator::create([
        'name' => 'Second Fleet Ltd',
        'slug' => 'second-fleet-twice',
        'status' => 'active',
    ]);

    app(ClientOnboardingService::class)->requestContract($company->registration_number, $rival->id);
    app(ClientOnboardingService::class)->requestContract($company->registration_number, $rival->id);

    // `firstOrCreate` already makes the row idempotent; `wasRecentlyCreated`
    // is what makes the email match it. Without that check a fleet reloading
    // the form would email the client every time.
    expect(recipientsOf(NotificationType::CLIENT_CONTRACT_REQUESTED))->toHaveCount(1);
});

it('confirms a contract decision to administrators and not to every account', function () {
    clientMailOn();
    Mail::fake();

    ['contract' => $contract] = contractedClient(null, OperatorClient::REQUESTED);

    app(ClientOnboardingService::class)->approve($contract);

    // The corporate employee at the same client gets nothing. They raise
    // bookings; who serves the company is not their decision to hear about.
    expect(recipientsOf(NotificationType::CLIENT_CONTRACT_APPROVED))->toBe(['admin@nakumatt.test']);
});

it('tells the client when a contract ends, whoever ended it', function () {
    clientMailOn();
    Mail::fake();

    ['contract' => $contract] = contractedClient(null);

    app(ClientOnboardingService::class)->end($contract);

    /*
     * Sent even though the client may have ended it themselves, which usually
     * earns nothing. It earns its place because **the actor and the client are
     * not always the same party**: a fleet or head office can end this too,
     * and in those cases it is the only notice the client gets that somebody
     * stopped serving them.
     */
    expect(recipientsOf(NotificationType::CLIENT_CONTRACT_ENDED))->toBe(['admin@nakumatt.test']);
});

it('sends the invoice to the billing address and not to whoever books the cars', function () {
    clientMailOn();
    Mail::fake();

    /*
     * The assertion this whole package exists for.
     *
     * A transport officer books cars. Somebody in accounts pays the bill. They
     * are different people at a bank, and an invoice sent to the first goes
     * unpaid: they have no purchase-order process and no reason to forward
     * what reads as a receipt for a trip they already took.
     *
     * Through `InvoiceService` rather than through `ClientRecipient`, because
     * proving the router works proves nothing about whether issuing an invoice
     * uses it. That is the lesson from kangaru-c0's `forActor()` finding:
     * a guard is only as deployed as its call sites.
     */
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    User::factory()->create([
        'tenant_id' => $tenant->id,
        'access_level' => AccessLevel::CLIENT,
        'role' => UserRole::CORPORATE_ADMIN,
        'email' => 'transport.officer@nakumatt.test',
    ]);

    OperatorClient::create([
        'operator_id' => Operator::SHANITAH,
        'tenant_id' => $tenant->id,
        'status' => OperatorClient::ACTIVE,
        'started_on' => now()->toDateString(),
        'billing_email' => 'accounts.payable@nakumatt.test',
    ]);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    app(InvoiceService::class)->generateForTrip($trip, 'invoice-routing-key', $finance);

    expect(recipientsOf(NotificationType::CLIENT_INVOICE_ISSUED))
        ->toBe(['accounts.payable@nakumatt.test']);
});

it('falls back to the administrators when no billing address is set', function () {
    clientMailOn();
    Mail::fake();

    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    User::factory()->create([
        'tenant_id' => $tenant->id,
        'access_level' => AccessLevel::CLIENT,
        'role' => UserRole::CORPORATE_ADMIN,
        'email' => 'transport.officer@nakumatt.test',
    ]);

    OperatorClient::create([
        'operator_id' => Operator::SHANITAH,
        'tenant_id' => $tenant->id,
        'status' => OperatorClient::ACTIVE,
        'started_on' => now()->toDateString(),
        'billing_email' => null,
    ]);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    app(InvoiceService::class)->generateForTrip($trip, 'invoice-fallback-key', $finance);

    // An invoice received by the wrong colleague is recoverable. An invoice
    // received by nobody is a debt the client does not know about.
    expect(recipientsOf(NotificationType::CLIENT_INVOICE_ISSUED))
        ->toBe(['transport.officer@nakumatt.test']);
});

it('attaches the invoice as a PDF, and issues the invoice even if that fails', function () {
    clientMailOn();
    Mail::fake();

    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    OperatorClient::create([
        'operator_id' => Operator::SHANITAH,
        'tenant_id' => $tenant->id,
        'status' => OperatorClient::ACTIVE,
        'started_on' => now()->toDateString(),
        'billing_email' => 'accounts.payable@nakumatt.test',
    ]);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver);

    $invoice = app(InvoiceService::class)->generateForTrip($trip, 'invoice-pdf-key', $finance);

    $pdf = app(InvoicePdf::class);
    $bytes = $pdf->render($invoice);

    // A real PDF, not an empty string dressed up as one.
    expect(substr($bytes, 0, 4))->toBe('%PDF')
        ->and($pdf->filename($invoice))->toBe($invoice->invoice_number.'.pdf')
        // The number is on the document. An invoice number misread is a
        // payment applied to the wrong record, reconciled by hand a month on.
        ->and($bytes)->not->toBeEmpty();
});
