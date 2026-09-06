<?php

use App\Support\Observability\ScrubsSecrets;
use Illuminate\Support\Facades\File;

/**
 * Every config file must survive `php artisan config:cache`.
 *
 * ## The failure this exists because of
 *
 * ADR-0054 shipped `config/sentry.php` with `'before_send' => new
 * ScrubsSecrets`. An object in a config array. It passed Pint, Larastan, 1455
 * backend tests, 575 frontend tests and a production bundle build, and it
 * made the application **unbootable**:
 *
 * Each container runs `config:cache` at start (`deploy/README.md` §1).
 * Laravel `var_export`s the merged config, an object without `__set_state()`
 * cannot be exported, and Laravel rethrows it as *"Your configuration files
 * are not serializable."* The container never reports healthy, the deploy
 * halts, and nothing in a test run is anywhere near it — the test environment
 * reads config from PHP, never from the cache.
 *
 * CI's deploy-stack job caught it, twenty minutes and a full image build
 * later, as `dependency failed to start: container kangaru-app-1 is
 * unhealthy`. That is a true signal and a terrible error message. This test
 * is the same signal in under a second, naming the file.
 *
 * ## Why it walks `config/` rather than pinning the one file
 *
 * The mistake is not specific to Sentry. Any config that reaches for a
 * closure, an enum instance, or a `new` anything has the same shape, and the
 * next one will be in a file nobody thought to add here.
 */
it('exports every config file and reads it back, the way config:cache does', function () {
    $unserializable = [];

    foreach (File::files(config_path()) as $file) {
        if ($file->getExtension() !== 'php') {
            continue;
        }

        $values = require $file->getPathname();

        try {
            /*
             * **Export *and* evaluate.** The first version of this test only
             * called `var_export()` and passed against the very bug it was
             * written for — caught by mutation, which is why the rule about
             * proving a guard exists.
             *
             * `var_export` does not throw on an object: it happily writes
             * `\App\Foo::__set_state(array(...))`. The Error is raised when
             * that string is *read back*, because the method does not exist.
             * `ConfigCacheCommand` writes the file and then requires it, so
             * the round trip is the thing to reproduce — half of it proves
             * nothing.
             */
            $exported = var_export($values, true);
            eval("return {$exported};");
        } catch (Throwable $e) {
            $unserializable[$file->getFilename()] = $e->getMessage();
        }
    }

    // Named, not counted. "3 config files are not serializable" sends
    // somebody to open all of them.
    expect($unserializable)->toBe([]);
});

/**
 * The Sentry callback specifically, because it is the one that has already
 * been got wrong and because getting it right is not obvious.
 */
it('keeps the Sentry before_send hook as a callable that is also a plain array', function () {
    $beforeSend = config('sentry.before_send');

    // Callable, or the scrubber silently never runs and credentials ship.
    expect(is_callable($beforeSend))->toBeTrue();

    // **And** exportable. `new ScrubsSecrets` satisfies the line above and
    // fails this one, which is exactly the bug that reached CI.
    expect($beforeSend)->toBeArray();
    expect($beforeSend[0])->toBe(ScrubsSecrets::class);
});
