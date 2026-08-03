<?php

use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\ValidatesOpenApiContract;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind a different classes or traits.
|
*/

// ValidatesOpenApiContract is the ADR-0011 gate: it wraps every HTTP
// round-trip these suites make and validates the JSON response against
// docs/api/openapi.yaml. The ~471 existing round-trips are the contract
// tests — there is no second suite.
pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class, ValidatesOpenApiContract::class)
    ->in('Feature');

// Concurrency tests spawn real OS processes that must see the fixture data,
// so they truncate committed rows between tests instead of rolling back an
// uncommitted transaction the child processes could never read.
pest()->extend(TestCase::class)
    ->use(DatabaseTruncation::class, ValidatesOpenApiContract::class)
    ->in('Concurrency');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

function something()
{
    // ..
}
