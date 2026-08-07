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
    ])
    ->withMiddleware(function (Middleware $middleware): void {
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
