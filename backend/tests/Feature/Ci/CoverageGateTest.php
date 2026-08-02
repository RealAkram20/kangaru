<?php

/**
 * The coverage gate, tested against synthetic Clover reports.
 *
 * This project has already shipped a coverage gate that could not work:
 * `pest --coverage --min=90 --path=Modules/Dispatch` — `--path` is not a
 * coverage-scoping option, Pest rejects it, and the step failed regardless
 * of the real number. Nobody noticed because CI only runs on `main` and the
 * branch that introduced it had never been merged.
 *
 * `bin/coverage-gate.php` replaced it and **has still never executed**, for
 * exactly the same reason. A gate nothing has run is a gate nobody knows
 * the behaviour of, and the two ways it can be wrong are not symmetric: a
 * spurious failure is loud and annoying, a spurious pass is silent and is
 * the bug this project already has once.
 *
 * These run the real script as a subprocess against reports whose numbers
 * are known by construction, so the arithmetic and the guards are proved
 * without needing a coverage driver — which this machine does not have,
 * and which is why the gate cannot otherwise be checked before the merge.
 */
function cloverReport(array $files): string
{
    $root = str_replace('\\', '/', dirname(__DIR__, 3));

    $lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<coverage><project>'];

    foreach ($files as $path => [$statements, $covered]) {
        $lines[] = sprintf(
            '<file name="%s/%s"><metrics statements="%d" coveredstatements="%d"/></file>',
            $root,
            $path,
            $statements,
            $covered,
        );
    }

    $lines[] = '</project></coverage>';

    // tempnam creates the file it names; the report needs an .xml suffix,
    // so the placeholder is removed rather than left behind on every run.
    $stub = tempnam(sys_get_temp_dir(), 'clover');
    unlink($stub);
    $file = $stub.'.xml';
    file_put_contents($file, implode("\n", $lines));

    return $file;
}

/** @return array{exit: int, output: string} */
function runGate(string $reportPath): array
{
    $script = dirname(__DIR__, 3).'/bin/coverage-gate.php';

    $output = [];
    $exit = 0;
    exec(sprintf('php %s %s 2>&1', escapeshellarg($script), escapeshellarg($reportPath)), $output, $exit);

    return ['exit' => $exit, 'output' => implode("\n", $output)];
}

/** Every gate comfortably satisfied: 100% everywhere. */
function passingFiles(): array
{
    return [
        'Modules/Billing/Services/InvoiceService.php' => [100, 100],
        'Modules/Dispatch/Services/DispatchService.php' => [50, 50],
        'app/Models/User.php' => [40, 40],
    ];
}

it('passes when every gate is satisfied', function () {
    $result = runGate(cloverReport(passingFiles()));

    expect($result['exit'])->toBe(0);
    expect($result['output'])->toContain('Modules/Billing');
    expect($result['output'])->toContain('100.00%');
});

it('fails the Billing gate at 89% and passes it at 90%', function () {
    // The boundary itself, from both sides. A `>` where the script means
    // `>=` would reject a module sitting exactly on the threshold, which
    // is the off-by-one nobody finds until it blocks a merge.
    $just_under = runGate(cloverReport([
        'Modules/Billing/Services/InvoiceService.php' => [100, 89],
        'Modules/Dispatch/Services/DispatchService.php' => [50, 50],
        'app/Models/User.php' => [1000, 1000],
    ]));

    expect($just_under['exit'])->toBe(1);
    expect($just_under['output'])->toContain('FAIL');

    $exactly_on = runGate(cloverReport([
        'Modules/Billing/Services/InvoiceService.php' => [100, 90],
        'Modules/Dispatch/Services/DispatchService.php' => [50, 50],
        'app/Models/User.php' => [1000, 1000],
    ]));

    expect($exactly_on['exit'])->toBe(0);
});

it('fails the overall gate independently of the module gates', function () {
    // Both modules perfect, everything else barely tested. The overall
    // floor is what catches a codebase whose only covered code is the two
    // modules with gates on them.
    $result = runGate(cloverReport([
        'Modules/Billing/Services/InvoiceService.php' => [10, 10],
        'Modules/Dispatch/Services/DispatchService.php' => [10, 10],
        'app/Models/User.php' => [1000, 100],
    ]));

    expect($result['exit'])->toBe(1);
    expect($result['output'])->toContain('Overall');
});

it('fails rather than passes when a gate matches no files at all', function () {
    // The rename trap, and the more dangerous direction of the two. If
    // Modules/Dispatch were moved or renamed, a gate that skipped its
    // absent prefix would report success forever — the module would look
    // permanently compliant precisely because it had stopped being
    // measured.
    $result = runGate(cloverReport([
        'Modules/Billing/Services/InvoiceService.php' => [100, 100],
        'app/Models/User.php' => [40, 40],
    ]));

    expect($result['exit'])->toBe(1);
    expect($result['output'])->toContain('no files matched');
    expect($result['output'])->toContain('Modules/Dispatch');
});

it('refuses a report containing no files', function () {
    // "Coverage ran and measured nothing" must never read as "everything
    // is covered". This is the failure mode of a misconfigured pcov
    // directory, which the workflow already carries a comment about.
    $result = runGate(cloverReport([]));

    expect($result['exit'])->toBe(1);
    expect($result['output'])->toContain('coverage was not actually measured');
});

it('refuses a report that is not there', function () {
    $result = runGate(sys_get_temp_dir().'/definitely-not-a-report.xml');

    expect($result['exit'])->toBe(1);
    expect($result['output'])->toContain('Coverage report not found');
});

it('names the worst offenders so a red build is a to-do list', function () {
    $result = runGate(cloverReport([
        'Modules/Billing/Services/InvoiceService.php' => [100, 10],
        'Modules/Billing/Pricing/TripPricingEngine.php' => [100, 95],
        'Modules/Dispatch/Services/DispatchService.php' => [50, 50],
        'app/Models/User.php' => [1000, 1000],
    ]));

    expect($result['exit'])->toBe(1);
    // The file missing 90 statements, not the one missing 5.
    expect($result['output'])->toContain('InvoiceService.php');
    expect($result['output'])->toContain('90 uncovered');
});

it('normalises Windows paths so the prefixes match on either platform', function () {
    // The report is written by whichever machine ran the suite. A gate
    // keyed on `Modules/Billing` that never matched `Modules\Billing`
    // would hit the no-files-matched guard above — loudly on a developer
    // machine, and never at all on CI, which is the wrong way round for
    // anybody trying to reproduce a CI result locally.
    $root = str_replace('/', '\\', str_replace('\\', '/', dirname(__DIR__, 3)));

    // tempnam creates the file it names; the report needs an .xml suffix,
    // so the placeholder is removed rather than left behind on every run.
    $stub = tempnam(sys_get_temp_dir(), 'clover');
    unlink($stub);
    $file = $stub.'.xml';
    file_put_contents($file, implode("\n", [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<coverage><project>',
        sprintf(
            '<file name="%s\Modules\Billing\Services\InvoiceService.php">'
            .'<metrics statements="100" coveredstatements="100"/></file>',
            $root,
        ),
        sprintf(
            '<file name="%s\Modules\Dispatch\Services\DispatchService.php">'
            .'<metrics statements="50" coveredstatements="50"/></file>',
            $root,
        ),
        '</project></coverage>',
    ]));

    $result = runGate($file);

    expect($result['exit'])->toBe(0);
    expect($result['output'])->not->toContain('no files matched');
});
