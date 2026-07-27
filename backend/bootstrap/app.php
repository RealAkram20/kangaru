<?php

use App\Enums\ErrorCode;
use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\IdentifyTenant;
use App\Support\Api\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Support\Facades\Context;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->api(prepend: [
            AssignRequestId::class,
        ]);

        $middleware->alias([
            'tenant' => IdentifyTenant::class,
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
