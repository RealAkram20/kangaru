<?php

use Symfony\Component\Finder\Finder;

/**
 * W1-c · Security gate — no resource spreads a whole object.
 *
 * `docs/screen-rules.md` §2 and the W1-c brief: allow-list fields; never
 * spread a model into a response. The column that makes the rule worth a CI
 * test is `order_requests.details`, a JSON blob written by the public order
 * form that carries `sender_phone` and `recipient_phone` beside the harmless
 * keys — a resource emitting it whole leaks two personal numbers and looks
 * innocent in review, because the field is called `details`.
 *
 * This is a static scan of every `Modules/*\/Resources/*.php` file:
 *
 *  1. **Forbidden outright** — the spellings that serialise a model or its
 *     attribute bag wholesale. None exists today; none may be added.
 *  2. **Pinned** — the two resources that emit `'details' => $this->details`
 *     today (finding W1-c-F1 in `docs/security-gate.md`). Both audiences are
 *     narrow: the walk-in desk that must ring both parties, and the customer
 *     reading back their own form. Pinned at exactly these two, so a third
 *     cannot join them, and so that when the Bookings module moves them onto
 *     `OrderDetails` allow-lists this test fails and the pin comes out.
 *  3. **Pinned** — the two resource-into-resource spreads (`...(new
 *     DriverResource(...))->toArray($request)`), which are allow-listed at
 *     one remove and acceptable, but are the shape that becomes a model
 *     spread by accident. Named so a third is a decision.
 *
 * Every assertion is a count. A grep that finds nothing because it looked at
 * nothing is the failure mode of every static test, so the number of files
 * scanned is asserted too.
 */

/**
 * @return array<string, string> relative path => contents
 */
function resourceSources(): array
{
    $finder = Finder::create()
        ->files()
        ->in([base_path('Modules'), base_path('app')])
        ->path('/Resources/')
        ->name('*.php');

    $sources = [];

    foreach ($finder as $file) {
        $sources[str_replace('\\', '/', $file->getRelativePathname())] = $file->getContents();
    }

    ksort($sources);

    return $sources;
}

/**
 * Lines that are code, not comment: a docblock *describing* the forbidden
 * spelling must not trip the scan.
 */
function codeLines(string $source): string
{
    $lines = array_filter(
        explode("\n", $source),
        fn (string $line): bool => ! preg_match('#^\s*(\*|/\*\*|\*/|//)#', $line),
    );

    return implode("\n", $lines);
}

it('scans every resource file, and there are enough of them for the scan to mean something', function () {
    expect(count(resourceSources()))->toBeGreaterThanOrEqual(41);
});

it('finds no resource that serialises a model or its attribute bag wholesale', function () {
    $forbidden = [
        'parent::toArray(',
        '$this->resource->toArray(',
        '$this->resource->attributesToArray(',
        '$this->attributesToArray(',
        '$this->getAttributes(',
        '$this->resource->getAttributes(',
        '$this->toArray()',
    ];

    $hits = [];

    foreach (resourceSources() as $path => $source) {
        $code = codeLines($source);

        foreach ($forbidden as $needle) {
            if (str_contains($code, $needle)) {
                $hits[] = "{$path}: {$needle}";
            }
        }
    }

    expect($hits)->toBe([]);
});

it('emits order_requests.details wholesale from exactly the two resources the census names', function () {
    $emitters = [];

    foreach (resourceSources() as $path => $source) {
        if (preg_match("/'details'\s*=>\s*\\\$this->details\b/", codeLines($source))) {
            $emitters[] = $path;
        }
    }

    // W1-c-F1. The desk queue and the customer's read-back of their own
    // form. When the Bookings module routes both through
    // `OrderDetails` allow-lists, this list goes to [] and the finding closes.
    expect($emitters)->toBe([
        'Bookings/Resources/OrderRequestResource.php',
        'Customers/Resources/CustomerOrderRequestResource.php',
    ]);
});

it('spreads one resource into another in exactly the two dispatch candidate resources', function () {
    $spreads = [];

    foreach (resourceSources() as $path => $source) {
        if (preg_match('/\.\.\.\(new \w+Resource\(.*\)\)->toArray\(\$request\)/', codeLines($source))) {
            $spreads[] = $path;
        }
    }

    expect($spreads)->toBe([
        'Dispatch/Resources/CandidateDriverResource.php',
        'Dispatch/Resources/CandidateVehicleResource.php',
    ]);
});

it('reads details only through OrderDetails everywhere else, so PACKAGE_FIELDS and PAYMENT_FIELDS are the whole allow-list', function () {
    // The class documents itself as "the one place `order_requests.details`
    // is read". That is true of every reader that *filters* it; the two
    // pinned above emit it whole. Here: no third spelling — `$this->details[`
    // or `->details['` — reaches into the blob by key from a resource.
    $direct = [];

    foreach (resourceSources() as $path => $source) {
        if (preg_match('/details\[/', codeLines($source))) {
            $direct[] = $path;
        }
    }

    expect($direct)->toBe([]);
});
