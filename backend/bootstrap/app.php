<?php

use App\Enums\ErrorCode;
use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\BindSubjectTenant;
use App\Http\Middleware\EnforceTokenScope;
use App\Http\Middleware\EnsureMfaEnrolled;
use App\Http\Middleware\IdentifyTenant;
use App\Support\Api\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Support\Facades\Context;
use Illuminate\Validation\ValidationException;
use Modules\Dispatch\Console\AdvanceDispatchOffers;
use Modules\Drivers\Console\AwardWeeklyBonuses;
use Modules\Fleet\Console\CloseStaleDutySessions;
use Modules\Reports\Console\PruneReportExports;
use Modules\Trips\Console\MaintainTripLocationPartitions;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // Laravel auto-discovers commands only under app/Console/Commands, so
    // module-owned commands are registered explicitly — the same
    // "explicit over convention across Modules\" stance as the policy and
    // factory registrations.
    ->withCommands([
        PruneReportExports::class,
        MaintainTripLocationPartitions::class,
        AdvanceDispatchOffers::class,
        AwardWeeklyBonuses::class,
        CloseStaleDutySessions::class,
    ])
    ->withMiddleware(function (Middleware $middleware): void {
        // ---------------------------------------------------------------------
        // Who is allowed to tell us where a request came from.
        //
        // Without this, `request()->ip()` is the immediate peer — which behind
        // a reverse proxy is the proxy. Measured on the live server before it
        // was set, every single request looked like this:
        //
        //   10.0.3.9 - - "GET /up" 200 "-" "102.86.7.251"
        //
        // The real client was there all along, in `X-Forwarded-For`; Laravel
        // simply was not permitted to believe it. Two things read that value
        // and both were wrong:
        //
        //   - `AuditLog` writes `ip_address` on every mutation. A trail that
        //     records the proxy's container address for every action by every
        //     user cannot answer "where did this come from", which is most of
        //     what PRODUCT.md sells to a bank.
        //   - `AppServiceProvider` rate-limits `->by($request->ip())`. One
        //     bucket for the entire internet: an attacker on the OTP path
        //     exhausts the limit for every legitimate user at once, and
        //     AGENTS.md names SMS pumping fraud as a real cost here.
        //
        // **Why a list and not `'*'`.** Trusting every hop means believing an
        // `X-Forwarded-For` a stranger wrote. Anyone who finds the origin
        // address could then forge the audit trail and walk past the rate
        // limiter wearing a different IP each time. Symfony walks the chain
        // right-to-left and stops at the first hop it does not trust, so
        // naming the hops is what makes a forged prefix inert.
        //
        // Two groups, and both are needed:
        //
        //   - The private ranges: Traefik, which is the only thing that can
        //     reach these containers — no service publishes a host port.
        //   - Cloudflare's edge, since the domains are proxied. Without it the
        //     chain stops at Cloudflare and every user is recorded as
        //     Cloudflare.
        //
        // **The Cloudflare list changes a few times a year.** It is pinned
        // here rather than fetched at boot, because a request-path dependency
        // on an external URL is a worse failure than a stale range. Re-check
        // https://www.cloudflare.com/ips/ — docs/runbook.md carries this as a
        // standing item. Last refreshed from that endpoint 2026-08-21.
        // ---------------------------------------------------------------------
        $middleware->trustProxies(at: [
            // Docker's own networks: Traefik, and nothing else, can reach us.
            '10.0.0.0/8',
            '172.16.0.0/12',
            '192.168.0.0/16',

            // Cloudflare IPv4 — https://www.cloudflare.com/ips-v4
            '173.245.48.0/20',
            '103.21.244.0/22',
            '103.22.200.0/22',
            '103.31.4.0/22',
            '141.101.64.0/18',
            '108.162.192.0/18',
            '190.93.240.0/20',
            '188.114.96.0/20',
            '197.234.240.0/22',
            '198.41.128.0/17',
            '162.158.0.0/15',
            '104.16.0.0/13',
            '104.24.0.0/14',
            '172.64.0.0/13',
            '131.0.72.0/22',

            // Cloudflare IPv6 — https://www.cloudflare.com/ips-v6
            '2400:cb00::/32',
            '2606:4700::/32',
            '2803:f800::/32',
            '2405:b500::/32',
            '2405:8100::/32',
            '2a06:98c0::/29',
            '2c0f:f248::/32',
        ]);

        $middleware->api(prepend: [
            AssignRequestId::class,
        ]);

        // ADR-0008 decision 3: a user whose role requires a second factor
        // and has not enrolled can do nothing but enrol.
        //
        // On the whole API group rather than per-route, for the same reason
        // BindSubjectTenant is: a rule applied route-by-route is a rule
        // missing from the route somebody adds next month, and the failure
        // here is a Finance officer issuing invoices without the factor the
        // bank was told they use. A new endpoint is covered on arrival.
        //
        // Ordered below so it runs *after* authentication — before it,
        // `$request->user()` is null and this would wave everything
        // through. That ordering is the whole of its correctness.
        $middleware->api(append: [
            // ADR-0022. Must run *after* `auth:sanctum` has resolved the
            // token, which the priority list below arranges — before it,
            // `currentAccessToken()` is null on every request and the
            // middleware would wave everything through.
            EnforceTokenScope::class,
            EnsureMfaEnrolled::class,
        ]);

        $middleware->alias([
            'tenant' => IdentifyTenant::class,
            'subject-tenant' => BindSubjectTenant::class,
        ]);

        // Laravel's default middleware priority runs SubstituteBindings
        // (implicit {model} route-parameter resolution) right after auth,
        // but our custom `tenant` alias isn't in that priority list at all,
        // so — being unprioritized — it was landing AFTER SubstituteBindings
        // in practice. That meant any single-resource route (companies/{id})
        // tried to resolve the bound model before TenantContext was set,
        // so TenantScope's fail-closed default made every such lookup 404 —
        // including for the resource's own tenant. Force `tenant` to run
        // immediately after authentication and before model binding.
        $middleware->appendToPriorityList(
            after: AuthenticatesRequests::class,
            append: IdentifyTenant::class,
        );

        // Immediately after authentication, and before anything that reads
        // data. Appended to the api group above, which alone would place it
        // *before* the route's `auth:sanctum` — group middleware runs ahead
        // of route middleware — so it would see a null user on every
        // request and enforce nothing at all. Being in the priority list is
        // what actually makes it run in the right place.
        $middleware->appendToPriorityList(
            after: AuthenticatesRequests::class,
            append: EnsureMfaEnrolled::class,
        );

        // ADR-0022, and in the priority list for exactly the reason above:
        // appended to the api group alone it would run *before* the route's
        // `auth:sanctum`, see no token, and permit everything. A scope
        // enforcer that silently enforces nothing is worse than none,
        // because it looks like protection on the org chart.
        $middleware->appendToPriorityList(
            after: AuthenticatesRequests::class,
            append: EnforceTokenScope::class,
        );

        // And its counterpart runs immediately AFTER model binding, because
        // it exists to read the bound record (ADR-0006 Decision 4: platform
        // staff write into the tenant of the record they are acting on, not
        // their own — they have none). Before SubstituteBindings there is no
        // subject to read, so the ordering is the feature, not a detail.
        $middleware->appendToPriorityList(
            after: SubstituteBindings::class,
            append: BindSubjectTenant::class,
        );

        // This is an API-only app with no 'login' route. Laravel's
        // ApplicationBuilder defaults the guest redirect to route('login'),
        // which throws RouteNotFoundException for any unauthenticated
        // request that doesn't send an Accept: application/json header.
        // Overriding to null lets AuthenticationException construct cleanly
        // so our render() callback below handles it as JSON, always.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (ValidationException $e, $request) {
            if ($request->is('api/*')) {
                return ApiResponse::error(
                    ErrorCode::VALIDATION_FAILED,
                    'The given data was invalid.',
                    $e->errors(),
                    422,
                );
            }
        });

        $exceptions->render(function (AuthenticationException $e, $request) {
            if ($request->is('api/*')) {
                return ApiResponse::error(
                    ErrorCode::UNAUTHENTICATED,
                    'Authentication is required to access this resource.',
                    [],
                    401,
                );
            }
        });

        $exceptions->render(function (AuthorizationException|AccessDeniedHttpException $e, $request) {
            if ($request->is('api/*')) {
                return ApiResponse::error(
                    ErrorCode::FORBIDDEN,
                    'You do not have permission to perform this action.',
                    [],
                    403,
                );
            }
        });

        $exceptions->render(function (ModelNotFoundException|NotFoundHttpException $e, $request) {
            if ($request->is('api/*')) {
                return ApiResponse::error(
                    ErrorCode::NOT_FOUND,
                    'The requested resource could not be found.',
                    [],
                    404,
                );
            }
        });

        $exceptions->render(function (Throwable $e, $request) {
            if ($request->is('api/*') && ! app()->hasDebugModeEnabled()) {
                return ApiResponse::error(
                    ErrorCode::SERVER_ERROR,
                    'Something went wrong on our end. Please try again, and contact support if the problem continues.',
                    [],
                    500,
                );
            }
        });

        $exceptions->context(fn () => Context::all());
    })->create();
