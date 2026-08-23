<?php

use Illuminate\Support\Facades\Route;

/**
 * Which hop the platform believes when it asks where a request came from.
 *
 * This is not a formality. `request()->ip()` has exactly two consumers and
 * both of them matter:
 *
 *   - `AuditLog` stamps `ip_address` on every mutation. PRODUCT.md sells
 *     audit-grade correctness to a bank; a trail that records the reverse
 *     proxy's container address for every action by every user cannot answer
 *     the one question an auditor asks.
 *   - `AppServiceProvider` rate-limits `->by($request->ip())`. If every
 *     request shares one address, that is one bucket for the entire internet:
 *     an attacker on the OTP path locks out every legitimate user at the same
 *     moment, and AGENTS.md names SMS pumping fraud as a real cost here.
 *
 * On the live server, before `trustProxies` was configured, the access log
 * read `10.0.3.9 - - "GET /up" 200 "-" "102.86.7.251"` — the real client was
 * present the whole time and the framework was not permitted to believe it.
 *
 * The third test is the one worth keeping. Trusting the chain is only safe
 * because a *forged prefix is inert*: Symfony walks right-to-left and stops at
 * the first hop it does not trust, so anything a stranger wrote to the left of
 * their own address is discarded rather than obeyed.
 */
beforeEach(function () {
    Route::get('/__client-ip', fn () => response()->json(['ip' => request()->ip()]));
});

it('believes the forwarded client when the hop is the proxy', function () {
    $this->withServerVariables(['REMOTE_ADDR' => '10.0.3.9'])
        ->withHeader('X-Forwarded-For', '102.86.7.251')
        ->getJson('/__client-ip')
        ->assertOk()
        ->assertJson(['ip' => '102.86.7.251']);
});

it('sees past Cloudflare to the person, not the edge', function () {
    // What arrives when the domain is proxied: the visitor, then the
    // Cloudflare edge that forwarded them, then Traefik as REMOTE_ADDR.
    // Both hops are trusted, so the answer is the visitor.
    $this->withServerVariables(['REMOTE_ADDR' => '10.0.3.9'])
        ->withHeader('X-Forwarded-For', '102.86.7.251, 172.68.10.1')
        ->getJson('/__client-ip')
        ->assertOk()
        ->assertJson(['ip' => '102.86.7.251']);
});

it('refuses a forged address and records the forger', function () {
    // Somebody who finds the origin address and writes their own
    // X-Forwarded-For. Traefik appends where they actually came from, so the
    // chain is [lie, truth]. `203.0.113.9` is untrusted, the walk stops
    // there, and the lie to its left is never reached.
    $this->withServerVariables(['REMOTE_ADDR' => '10.0.3.9'])
        ->withHeader('X-Forwarded-For', '1.2.3.4, 203.0.113.9')
        ->getJson('/__client-ip')
        ->assertOk()
        ->assertJson(['ip' => '203.0.113.9'])
        ->assertJsonMissing(['ip' => '1.2.3.4']);
});
