<?php

/**
 * Asserts AGENTS.md's coverage gates against a Clover report.
 *
 *     php bin/coverage-gate.php storage/coverage.xml
 *
 * AGENTS.md requires "90% on `Modules/Billing` and `Modules/Dispatch`, 70%
 * overall". This exists because the obvious way to express that in Pest does
 * not work:
 *
 *     pest --coverage --min=90 --path=Modules/Dispatch
 *
 * `--path` is not a coverage-scoping option — Pest rejects it outright with
 * "Option --path does not allow an argument" and exits non-zero. A gate
 * written that way fails whatever the real coverage is, which is exactly as
 * useless as one that passes whatever the real coverage is. It went unnoticed
 * because CI only runs on `main`, and the branch that introduced it had never
 * been merged.
 *
 * Reading one Clover report also means the suite runs once rather than once
 * per threshold.
 *
 * Percentages are statement coverage, matching what Clover records. That can
 * differ by a fraction from the line coverage Pest prints in its summary; the
 * thresholds here are the ones that gate the build.
 */
$reportPath = $argv[1] ?? null;

if ($reportPath === null || ! is_file($reportPath)) {
    fwrite(STDERR, "Coverage report not found: ".var_export($reportPath, true)."\n");
    exit(1);
}

/**
 * Each gate is a path prefix (relative to the backend root) and the minimum
 * percentage of statements that must be covered. `''` matches everything
 * measured, which is the overall floor.
 */
$gates = [
    ['label' => 'Overall', 'prefix' => '', 'min' => 70.0],
    ['label' => 'Modules/Dispatch', 'prefix' => 'Modules/Dispatch', 'min' => 90.0],
    ['label' => 'Modules/Billing', 'prefix' => 'Modules/Billing', 'min' => 90.0],
];

$xml = simplexml_load_file($reportPath);

if ($xml === false) {
    fwrite(STDERR, "Could not parse the Clover report at {$reportPath}.\n");
    exit(1);
}

$root = str_replace('\\', '/', dirname(__DIR__)).'/';

/** @var array<string, array{statements: int, covered: int}> $files */
$files = [];

foreach ($xml->xpath('//file') ?: [] as $file) {
    $name = str_replace('\\', '/', (string) $file['name']);
    $relative = str_starts_with($name, $root) ? substr($name, strlen($root)) : $name;

    $metrics = $file->metrics;

    if ($metrics === null) {
        continue;
    }

    $files[$relative] = [
        'statements' => (int) $metrics['statements'],
        'covered' => (int) $metrics['coveredstatements'],
    ];
}

if ($files === []) {
    fwrite(STDERR, "The Clover report contains no files — coverage was not actually measured.\n");
    exit(1);
}

$failed = false;

foreach ($gates as $gate) {
    $statements = 0;
    $covered = 0;
    $matched = 0;

    foreach ($files as $path => $metrics) {
        if ($gate['prefix'] !== '' && ! str_starts_with($path, $gate['prefix'])) {
            continue;
        }

        $matched++;
        $statements += $metrics['statements'];
        $covered += $metrics['covered'];
    }

    // A gate that matches nothing is a gate that silently stopped guarding
    // its module — a rename would otherwise turn it into a permanent pass.
    if ($matched === 0) {
        fwrite(STDERR, sprintf("FAIL  %-18s no files matched \"%s\"\n", $gate['label'], $gate['prefix']));
        $failed = true;

        continue;
    }

    $percent = $statements === 0 ? 100.0 : ($covered / $statements) * 100;
    $ok = $percent >= $gate['min'];
    $failed = $failed || ! $ok;

    printf(
        "%-5s %-18s %6.2f%%  (min %.0f%%, %d/%d statements across %d files)\n",
        $ok ? 'ok' : 'FAIL',
        $gate['label'],
        $percent,
        $gate['min'],
        $covered,
        $statements,
        $matched,
    );

    // Naming the worst offenders turns a red build into a to-do list.
    if (! $ok) {
        $offenders = [];

        foreach ($files as $path => $metrics) {
            if ($gate['prefix'] !== '' && ! str_starts_with($path, $gate['prefix'])) {
                continue;
            }

            $missed = $metrics['statements'] - $metrics['covered'];

            if ($missed > 0) {
                $offenders[$path] = $missed;
            }
        }

        arsort($offenders);

        foreach (array_slice($offenders, 0, 10, true) as $path => $missed) {
            printf("        %-62s %d uncovered\n", $path, $missed);
        }
    }
}

exit($failed ? 1 : 0);
