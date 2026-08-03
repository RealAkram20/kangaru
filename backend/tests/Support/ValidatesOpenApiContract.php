<?php

namespace Tests\Support;

use Illuminate\Testing\TestResponse;
use Osteel\OpenApi\Testing\Exceptions\ValidationException;
use PHPUnit\Framework\AssertionFailedError;
use Symfony\Component\HttpFoundation\Request;

/**
 * The contract gate (ADR-0011): every JSON response the suite provokes from
 * an /api/v1 endpoint is validated against docs/api/openapi.yaml.
 *
 * Registered in Pest.php, which puts it on every Feature and Concurrency
 * test. `call()` is the funnel all of MakesHttpRequests' helpers pour
 * through — getJson, postJson, actingAs()->… — so the suite's HTTP
 * round-trips become contract assertions without any test opting in, and
 * without a second suite duplicating fixtures. The spec is the source of
 * truth; a failure here means the CODE (or the spec entry in the same PR)
 * is wrong, and the fix is never "loosen the schema until it passes"
 * without deciding that the contract should say so.
 *
 * What is deliberately not validated:
 * - Non-JSON responses. The two binary endpoints (export download,
 *   odometer photo) are declared in the spec but their bytes prove
 *   nothing (ADR-0011 decision 6).
 * - 405s, 429s and 5xx. All are rendered by the framework, not by
 *   bootstrap/app.php's handlers, and under the test suite's APP_DEBUG
 *   they carry a debug body production never sends. The 429's production
 *   shape is documented in the spec; asserting the debug variant would
 *   document the wrong thing.
 * - HEAD/OPTIONS, which the spec does not model.
 */
trait ValidatesOpenApiContract
{
    /**
     * @param  Request|string  $method
     */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null): TestResponse
    {
        $response = parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);

        $this->assertResponseMatchesOpenApiContract((string) $method, (string) $uri, $response);

        return $response;
    }

    private function assertResponseMatchesOpenApiContract(string $method, string $uri, TestResponse $response): void
    {
        $method = strtolower($method);

        if (! in_array($method, ['get', 'post', 'put', 'patch', 'delete'], true)) {
            return;
        }

        $path = (string) (parse_url($uri, PHP_URL_PATH) ?: $uri);
        $path = '/'.ltrim($path, '/');

        if (! str_starts_with($path, '/api/v1/')) {
            return;
        }

        $status = $response->getStatusCode();

        // 405 joins 429: both are rendered by the framework, not by
        // bootstrap/app.php's handlers, so under APP_DEBUG they carry a
        // debug body production never sends.
        if ($status === 405 || $status === 429 || $status >= 500) {
            return;
        }

        // 204s have had their body and Content-Type stripped by
        // Response::prepare(); everything else non-JSON is a declared
        // binary. Neither has a body worth asserting on.
        if (! str_contains((string) $response->headers->get('Content-Type'), 'application/json')) {
            return;
        }

        try {
            ApiContractValidator::instance()->{$method}($response->baseResponse, $path);
        } catch (ValidationException $e) {
            throw new AssertionFailedError(sprintf(
                "Response did not match docs/api/openapi.yaml for [%s %s] (status %d).\n%s\n".
                'Either the code drifted from the contract, or this PR changes the '.
                'contract and the spec entry must change with it (ADR-0011).',
                strtoupper($method),
                $path,
                $status,
                $e->getMessage(),
            ));
        }
    }
}
