<?php

use App\Enums\Permission;
use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverPayoutAccount;
use Modules\Drivers\Resources\DriverPayoutAccountResource;

/**
 * Where a driver's money is sent (ADR-0042).
 *
 * This table holds the most directly exploitable data on the platform: a bank
 * account number and the name on it are worth something to somebody who never
 * touches the app, unlike a trip history. So most of what follows is about what
 * the endpoints **refuse** rather than what they store:
 *
 * - The whole number is never returned to a handset.
 * - It is not readable in the database.
 * - The office can read it, because a clerk cannot wire money to a mask — and
 *   that read is gated and audited.
 * - No driver can reach another's.
 */
function payoutDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

function validDetails(array $overrides = []): array
{
    return array_merge([
        'kind' => 'bank',
        'institution' => 'Stanbic',
        'account_holder' => 'John Kamau',
        'account_number' => '9030001234567',
    ], $overrides);
}

it('stores a destination and answers with it masked', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)
        ->putJson('/api/v1/me/payout-account', validDetails())
        ->assertOk()
        ->assertJsonPath('data.payout_account.institution', 'Stanbic')
        ->assertJsonPath('data.payout_account.last_four', '4567')
        ->assertJsonPath('data.payout_account.account_number_masked', '•••• 4567')
        // The driver's own name, shortened. Enough to recognise; a surname
        // alone is not a credential.
        ->assertJsonPath('data.payout_account.account_holder_masked', 'J. Kamau');
});

it('never returns the whole account number to the driver', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)->putJson('/api/v1/me/payout-account', validDetails())->assertOk();

    $response = $this->actingAs($user)->getJson('/api/v1/me/payout-account')->assertOk();

    // Asserted against the *whole response body*, not against a named field. A
    // field-by-field check passes happily when somebody adds a debug key, and
    // the thing being protected here is the string, wherever it appears.
    expect($response->getContent())->not->toContain('9030001234567');
    expect($response->getContent())->not->toContain('John Kamau');
});

it('does not store the account number in a readable column', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)->putJson('/api/v1/me/payout-account', validDetails())->assertOk();

    // Read around Eloquent, because the cast is exactly what is being tested.
    // Going through the model would decrypt it and assert nothing.
    $row = DB::table('driver_payout_accounts')->first();

    expect($row->account_number)->not->toBe('9030001234567')
        ->and($row->account_holder)->not->toBe('John Kamau')
        // And it must still be recoverable — "encrypted" must not quietly mean
        // "lost", which is the failure mode a one-way hash would give.
        ->and(DriverPayoutAccount::first()->account_number)->toBe('9030001234567');
});

it('keeps the readable tail in step with the number it summarises', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)->putJson('/api/v1/me/payout-account', validDetails())->assertOk();
    $this->actingAs($user)
        ->putJson('/api/v1/me/payout-account', validDetails(['account_number' => '5511119999']))
        ->assertOk();

    // The tail is the only part a driver ever sees to check. A stale one is a
    // silent lie on the single screen built to catch a mistake.
    expect(DriverPayoutAccount::first()->last_four)->toBe('9999');
    expect(DB::table('driver_payout_accounts')->count())->toBe(1);
});

it('cannot have its tail set by a caller', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)
        ->putJson('/api/v1/me/payout-account', validDetails(['last_four' => '0000']))
        ->assertStatus(422);
});

it('keeps one destination per driver, however many times it is saved', function (): void {
    [$user] = payoutDriver();

    foreach (['1111111111', '2222222222', '3333333333'] as $number) {
        $this->actingAs($user)
            ->putJson('/api/v1/me/payout-account', validDetails(['account_number' => $number]))
            ->assertOk();
    }

    // A count, not an existence check. Two destinations create a question at
    // the moment of paying — which one? — and the person answering it is a
    // clerk who does not know the driver's preference.
    expect(DriverPayoutAccount::count())->toBe(1);
    expect(DriverPayoutAccount::first()->account_number)->toBe('3333333333');
});

it('serves null for a driver who has given no details', function (): void {
    [$user] = payoutDriver();

    // A normal first visit, not an error. A 404 here would make the app treat
    // an empty form as a failure.
    $this->actingAs($user)
        ->getJson('/api/v1/me/payout-account')
        ->assertOk()
        ->assertJsonPath('data.payout_account', null);
});

it('removes it, and does not fail on a second removal', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)->putJson('/api/v1/me/payout-account', validDetails())->assertOk();

    $this->actingAs($user)->deleteJson('/api/v1/me/payout-account')->assertOk();
    $this->actingAs($user)->deleteJson('/api/v1/me/payout-account')->assertOk();

    expect(DriverPayoutAccount::count())->toBe(0);
});

it('accepts every account shape East Africa actually uses', function (): void {
    [$user] = payoutDriver();

    // A regex tuned to one bank would refuse a real account and leave its owner
    // unable to be paid, with no way to argue with it.
    $shapes = ['0700123456', '+256 700 123 456', '9030001234567', 'GB29NWBK60161331926819'];

    foreach ($shapes as $number) {
        $this->actingAs($user)
            ->putJson('/api/v1/me/payout-account', validDetails(['account_number' => $number]))
            ->assertOk();

        expect(DriverPayoutAccount::first()->account_number)->toBe($number);
    }
});

it('refuses a number too short to be one', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)
        ->putJson('/api/v1/me/payout-account', validDetails(['account_number' => '12']))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['account_number']);
});

it('refuses a partial save, because half a destination points somewhere wrong', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)->putJson('/api/v1/me/payout-account', validDetails())->assertOk();

    // Changing the bank while leaving last month's account number is a working
    // destination pointing at the wrong place — the worst state this row holds.
    $this->actingAs($user)
        ->putJson('/api/v1/me/payout-account', ['institution' => 'Centenary'])
        ->assertStatus(422);

    expect(DriverPayoutAccount::first()->institution)->toBe('Stanbic');
});

it('refuses a kind that is not one of the two', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)
        ->putJson('/api/v1/me/payout-account', validDetails(['kind' => 'crypto']))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['kind']);
});

it('cannot reach another driver, because there is no id to spell', function (): void {
    [$mine] = payoutDriver();
    [, $other] = payoutDriver();

    DriverPayoutAccount::create([
        'driver_id' => $other->getKey(),
    ] + validDetails(['account_number' => '8888888888']));

    $this->actingAs($mine)->putJson('/api/v1/me/payout-account', validDetails())->assertOk();

    // The property that makes the missing policy correct rather than an
    // oversight, asserted rather than assumed.
    expect(DriverPayoutAccount::where('driver_id', $other->getKey())->first()->account_number)
        ->toBe('8888888888');
});

it('answers 403 for an account with no driver profile', function (): void {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($user)->getJson('/api/v1/me/payout-account')->assertStatus(403);
    $this->actingAs($user)->putJson('/api/v1/me/payout-account', validDetails())->assertStatus(403);
});

it('records a change in the audit log', function (): void {
    [$user] = payoutDriver();

    $this->actingAs($user)->putJson('/api/v1/me/payout-account', validDetails())->assertOk();

    // A changed account number is the most valuable edit an attacker could make
    // to a driver's record. "The money went somewhere else last month" has to
    // be answerable rather than arguable.
    $account = DriverPayoutAccount::first();

    $this->assertDatabaseHas('audit_logs', [
        'auditable_type' => $account->getMorphClass(),
        'auditable_id' => $account->getKey(),
        'action' => 'created',
    ]);
});

describe('the office side', function (): void {
    it('shows the whole number to staff who may see the driver', function (): void {
        [$driverUser, $driver] = payoutDriver();

        $this->actingAs($driverUser)
            ->putJson('/api/v1/me/payout-account', validDetails())
            ->assertOk();

        $staff = User::factory()->create(['role' => UserRole::SUPER_ADMIN, 'tenant_id' => null]);

        // The point of the office resource: a clerk cannot wire money to a mask.
        $this->actingAs($staff)
            ->getJson("/api/v1/drivers/{$driver->getKey()}/payout-account")
            ->assertOk()
            ->assertJsonPath('data.payout_account.account_number', '9030001234567')
            ->assertJsonPath('data.payout_account.account_holder', 'John Kamau');
    });

    it('tells the office apart a driver with no details from no driver', function (): void {
        [, $driver] = payoutDriver();

        $staff = User::factory()->create(['role' => UserRole::SUPER_ADMIN, 'tenant_id' => null]);

        // The first is a phone call to the driver; the second is a bug. An
        // office that cannot tell them apart chases the wrong one.
        $this->actingAs($staff)
            ->getJson("/api/v1/drivers/{$driver->getKey()}/payout-account")
            ->assertStatus(404)
            ->assertJsonPath('code', 'NOT_FOUND');
    });

    it('refuses staff who may see drivers but not manage them', function (): void {
        [$driverUser, $driver] = payoutDriver();

        $this->actingAs($driverUser)
            ->putJson('/api/v1/me/payout-account', validDetails())
            ->assertOk();

        // **The distinction the policy exists for.** A dispatcher holds
        // `drivers.view` and needs it — they see who is on shift. They do not
        // need a bank account number, and gating this on `view` would have
        // handed one to every role that can open the drivers page.
        $dispatcher = User::factory()->create([
            'role' => UserRole::DISPATCHER,
            'tenant_id' => null,
        ]);

        expect($dispatcher->hasPermission(Permission::DRIVERS_VIEW))->toBeTrue();

        $this->actingAs($dispatcher)
            ->getJson("/api/v1/drivers/{$driver->getKey()}/payout-account")
            ->assertForbidden();
    });

    it('refuses a driver reading another driver s destination', function (): void {
        [$mineUser] = payoutDriver();
        [$otherUser, $other] = payoutDriver();

        $this->actingAs($otherUser)
            ->putJson('/api/v1/me/payout-account', validDetails())
            ->assertOk();

        // The office route takes an id, so unlike `/me` it *can* be spelled.
        // `DriverPolicy@view` is the thing standing in the way, and a driver
        // holding a driver token must not pass it.
        $this->actingAs($mineUser)
            ->getJson("/api/v1/drivers/{$other->getKey()}/payout-account")
            ->assertForbidden();
    });
});

describe('the holder mask', function (): void {
    it('shortens a full name to initials and a surname', function (): void {
        expect(DriverPayoutAccountResource::maskHolder('John Kamau'))->toBe('J. Kamau');
        expect(DriverPayoutAccountResource::maskHolder('John Peter Kamau'))->toBe('J. P. Kamau');
    });

    it('leaves a single name alone rather than reducing it to an initial', function (): void {
        // "M." identifies nobody and would read as a bug to the person whose
        // name it is.
        expect(DriverPayoutAccountResource::maskHolder('Musoke'))->toBe('Musoke');
    });

    it('survives the spacing a real form produces', function (): void {
        expect(DriverPayoutAccountResource::maskHolder('  John   Kamau  '))->toBe('J. Kamau');
    });
});
