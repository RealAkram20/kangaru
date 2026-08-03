<?php

/**
 * The route census (ADR-0011 decision 3).
 *
 * Response validation only covers endpoints the suite exercises — an
 * endpoint no test calls produces no response to validate and would pass by
 * silence. This closes that hole with a rule that is easy to defend: an
 * endpoint may be untested; it may not be undocumented.
 *
 * Both directions matter. A route missing from the spec is an undocumented
 * endpoint; a spec path with no route is a promise to the mobile team about
 * an endpoint that does not exist, which is worse.
 *
 * The comparison is method AND path, exactly as Laravel prints them — the
 * PUT|PATCH `apiResource` defaults were dropped in the same change that
 * introduced this census, precisely because the census would (correctly)
 * have refused to reconcile them with a spec that documents PATCH alone.
 */

use Illuminate\Support\Facades\Route;
use Symfony\Component\Yaml\Yaml;

function apiRouteInventory(): array
{
    $inventory = [];

    foreach (Route::getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/')) {
            continue;
        }

        foreach ($route->methods() as $method) {
            if (in_array($method, ['HEAD', 'OPTIONS'], true)) {
                continue;
            }

            $inventory[] = $method.' /'.$route->uri();
        }
    }

    sort($inventory);

    return $inventory;
}

function documentedOperations(): array
{
    $spec = Yaml::parseFile(base_path('../docs/api/openapi.yaml'));

    $operations = [];

    foreach ($spec['paths'] ?? [] as $path => $item) {
        foreach (['get', 'post', 'put', 'patch', 'delete'] as $verb) {
            if (array_key_exists($verb, $item)) {
                $operations[] = strtoupper($verb).' '.$path;
            }
        }
    }

    sort($operations);

    return $operations;
}

it('documents every api/v1 route in docs/api/openapi.yaml', function () {
    $undocumented = array_diff(apiRouteInventory(), documentedOperations());

    expect(array_values($undocumented))->toBe([], sprintf(
        "Routes with no entry in docs/api/openapi.yaml — the spec entry is part of the endpoint's PR (ADR-0011):\n%s",
        implode("\n", $undocumented),
    ));
});

it('documents no endpoint that does not exist', function () {
    $phantom = array_diff(documentedOperations(), apiRouteInventory());

    expect(array_values($phantom))->toBe([], sprintf(
        "Spec entries with no matching route — a contract promising endpoints that are not there:\n%s",
        implode("\n", $phantom),
    ));
});

it('still has routes and spec entries to compare', function () {
    // The census must never pass because one side was empty — an unreadable
    // spec or a broken route file would otherwise read as "fully
    // reconciled". Same instinct as the coverage gate's no-files-matched
    // guard.
    expect(count(apiRouteInventory()))->toBeGreaterThan(50);
    expect(count(documentedOperations()))->toBeGreaterThan(50);
});
