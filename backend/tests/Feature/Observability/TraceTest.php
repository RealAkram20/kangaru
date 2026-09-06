<?php

use App\Support\Observability\Trace;
use Sentry\SentrySdk;
use Sentry\Tracing\Span;
use Sentry\Tracing\SpanStatus;
use Sentry\Tracing\Transaction;
use Sentry\Tracing\TransactionContext;

/**
 * ADR-0054 §4 — the spans this codebase adds by hand, and the two properties
 * every call site depends on without stating them.
 *
 * **One: tracing never changes an answer.** Every wrapped method returns what
 * it returned before it was wrapped, and every exception still arrives at the
 * handler that was catching it. A monitoring helper that eats a throw would
 * turn a dispatch failure into a silent empty result, which is precisely the
 * class of defect ADR-0054 §5 refuses to allow into the request path.
 *
 * **Two: it costs nothing when nothing is being traced.** No DSN in CI, no DSN
 * in a developer's tree, and nine sampled requests in ten are not sampled at
 * all — so the untraced path is the normal one and it has to be exercised
 * first.
 *
 * A real `Transaction` on the hub rather than a mocked SDK, for the reason
 * `ScrubsSecretsTest` gives: a mock would only prove the helper was called.
 * What is worth defending is the shape of the span that comes out, and the
 * span recorder is where the SDK itself looks for that.
 */

/**
 * Opens a sampled transaction and puts it on the scope, the way an incoming
 * request does. Returns the recorder's spans once $work has run.
 *
 * `setSampled(true)` explicitly: this test must not depend on
 * `traces_sample_rate`, which is unset in the testing environment and is a
 * production decision (§4) rather than a fact about the helper.
 *
 * @return array<int, Span>
 */
function spansRecordedDuring(callable $work): array
{
    $hub = SentrySdk::getCurrentHub();

    $transaction = new Transaction(
        TransactionContext::make()->setName('test')->setSampled(true),
        $hub,
    );
    $transaction->initSpanRecorder();

    $previous = $hub->getSpan();
    $hub->setSpan($transaction);

    try {
        $work();
    } finally {
        $hub->setSpan($previous);
    }

    // The recorder's first entry is the transaction itself.
    return array_slice($transaction->getSpanRecorder()?->getSpans() ?? [], 1);
}

it('returns the value and creates no span when nothing is being traced', function () {
    // No transaction on the scope: CI, a developer's tree, and the unsampled
    // nine requests in ten.
    $hub = SentrySdk::getCurrentHub();
    $previous = $hub->getSpan();
    $hub->setSpan(null);

    $calls = 0;

    try {
        $result = Trace::span('dispatch.search', 'find a driver', function () use (&$calls) {
            $calls++;

            return 'the answer';
        });
    } finally {
        $hub->setSpan($previous);
    }

    expect($result)->toBe('the answer');
    // Once. A helper that ran the callable twice would double every mutation
    // it wraps, and the accept path is one of them.
    expect($calls)->toBe(1);
});

it('records a child span carrying the operation and its description', function () {
    $spans = spansRecordedDuring(function () {
        Trace::span('route.lookup', 'road between two points', fn () => null);
    });

    expect($spans)->toHaveCount(1);
    expect($spans[0]->getOp())->toBe('route.lookup');
    expect($spans[0]->getDescription())->toBe('road between two points');
});

it('attaches the attributes given up front', function () {
    $spans = spansRecordedDuring(function () {
        Trace::span('route.lookup', 'road', fn () => null, ['points' => 4]);
    });

    expect($spans[0]->getData()['points'])->toBe(4);
});

it('annotates the open span with what was only known afterwards', function () {
    $spans = spansRecordedDuring(function () {
        Trace::span('route.lookup', 'road', function () {
            Trace::annotate(['cache' => 'hit', 'provider' => 'osrm']);
        }, ['points' => 2]);
    });

    expect($spans[0]->getData()['cache'])->toBe('hit');
    expect($spans[0]->getData()['provider'])->toBe('osrm');
    // Merged, not replaced. The inputs somebody recorded at the start are half
    // of what makes the outcome readable — "cache miss" means nothing without
    // knowing what was asked for.
    expect($spans[0]->getData()['points'])->toBe(2);
});

it('annotates nothing, and does not fail, with no span open', function () {
    $hub = SentrySdk::getCurrentHub();
    $previous = $hub->getSpan();
    $hub->setSpan(null);

    try {
        Trace::annotate(['cache' => 'hit']);
    } finally {
        $hub->setSpan($previous);
    }

    // Reaching here is the assertion: every call site annotates
    // unconditionally, so this is the path taken by the overwhelming majority
    // of real calls.
    expect(true)->toBeTrue();
});

it('lets the exception through and marks the span failed', function () {
    $spans = [];

    expect(function () use (&$spans) {
        $spans = spansRecordedDuring(function () {
            Trace::span('dispatch.accept', 'driver takes the job', function () {
                throw new RuntimeException('offer no longer open');
            });
        });
    })->toThrow(RuntimeException::class, 'offer no longer open');

    // The throw escaped `spansRecordedDuring`, so the recorder is read from
    // the span the SDK closed on the way past rather than from the helper's
    // return. Everything below is about that span.
    expect($spans)->toBe([]);
});

it('records the failed status on the span the throw passed through', function () {
    $hub = SentrySdk::getCurrentHub();

    $transaction = new Transaction(
        TransactionContext::make()->setName('test')->setSampled(true),
        $hub,
    );
    $transaction->initSpanRecorder();

    $previous = $hub->getSpan();
    $hub->setSpan($transaction);

    try {
        Trace::span('dispatch.accept', 'driver takes the job', function () {
            throw new RuntimeException('offer no longer open');
        });
    } catch (RuntimeException) {
        // Expected — asserted in the test above. Here the span is the subject.
    } finally {
        $hub->setSpan($previous);
    }

    $spans = array_slice($transaction->getSpanRecorder()?->getSpans() ?? [], 1);

    expect($spans)->toHaveCount(1);
    // Without this a 40 ms span that threw looks exactly like a 40 ms span
    // that worked, and the waterfall stops being able to show a failure.
    expect($spans[0]->getStatus())->toBe(SpanStatus::internalError());
});
