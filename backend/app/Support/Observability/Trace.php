<?php

namespace App\Support\Observability;

use Sentry\SentrySdk;
use Sentry\Tracing\SpanContext;
use Sentry\Tracing\SpanStatus;
use Throwable;

/**
 * Naming the operations a stack trace cannot name (ADR-0054 §4).
 *
 * ## What was already being measured, and what was not
 *
 * The Laravel SDK opens a transaction per route and hangs spans under it for
 * every SQL query, every outbound HTTP call, every view and every cache read.
 * That answers *"which query"* very well and **"which operation" not at all**:
 * a dispatch search and the listing that renders it are both just runs of
 * SELECTs, indistinguishable in the waterfall, and the one number nobody has
 * is how much of a 1.2 s request the search itself was.
 *
 * A span here is a **label on work this codebase knows the name of**. It is
 * the only kind of tracing the SDK cannot do for us, which is the whole test
 * for whether one belongs somewhere.
 *
 * ## Why `\Sentry\trace()` and not `startTransaction`
 *
 * `\Sentry\trace()` creates a span **only if a sampled transaction is already
 * open**, and otherwise simply calls the callable. Every one of these is
 * therefore free:
 *
 * - in CI and in a developer's tree, where there is no DSN at all;
 * - in the nine requests out of ten that §4's `traces_sample_rate` of 0.1
 *   does not sample;
 * - in an artisan command or a test that never opened a transaction.
 *
 * There is no `if (config('sentry.dsn'))` anywhere in the call sites for the
 * same reason there is no null check around a logger: the cost of the disabled
 * path is a null comparison, and a guard at every call site is how one gets
 * forgotten at the call site that matters.
 *
 * ## It never changes what the caller returns, and never swallows
 *
 * `span()` returns the callable's value untouched and lets exceptions
 * propagate — it marks the span failed on the way past and rethrows. This is
 * the same rule ADR-0054 §5 sets for reporting: **observability that alters
 * behaviour has to be trusted inside the request path, and this does not need
 * to be.** A `finally` closes the span whichever way the callable leaves.
 */
final class Trace
{
    /**
     * Runs $work inside a named span.
     *
     * @template T
     *
     * @param  string  $op  the operation, dot-namespaced and stable — `dispatch.search`,
     *                      `route.lookup`. Sentry groups by this, so it must not carry
     *                      an id, a name, or anything else that varies per call.
     * @param  string  $description  the human half, shown on the waterfall row.
     * @param  callable(): T  $work
     * @param  array<string, mixed>  $data  attributes attached at the start. Facts only known
     *                                      afterwards go through {@see annotate()} instead.
     * @return T
     */
    public static function span(string $op, string $description, callable $work, array $data = [])
    {
        $context = SpanContext::make()
            ->setOp($op)
            ->setDescription($description)
            ->setData($data);

        return \Sentry\trace(static function () use ($work) {
            try {
                return $work();
            } catch (Throwable $e) {
                // The span outlives the throw — it is finished by the SDK's
                // own `finally` — so this is the only chance to record that
                // the operation failed rather than merely ended. Without it a
                // 40 ms span that threw is indistinguishable on the waterfall
                // from a 40 ms span that worked.
                self::status(SpanStatus::internalError());

                throw $e;
            }
        }, $context);
    }

    /**
     * Adds attributes to the span currently open.
     *
     * For the facts that are only known once the work is done — whether the
     * cache answered, how many candidates came back, which provider was
     * used. Those are exactly the attributes worth having and none of them
     * can be passed to {@see span()}, which runs before the answer exists.
     *
     * A no-op when nothing is being traced, which is the usual case.
     *
     * @param  array<string, mixed>  $data
     */
    public static function annotate(array $data): void
    {
        $span = SentrySdk::getCurrentHub()->getSpan();

        if ($span === null) {
            return;
        }

        // `Span::setData` merges — it is `array_merge` on the SDK's side, not
        // an assignment — so what `span()` recorded at the start survives.
        // That is a property of the SDK rather than of this line, which is
        // why `TraceTest` asserts it: an upgrade that changed it would
        // silently drop the inputs somebody recorded beside every outcome,
        // and "cache miss" means nothing without knowing what was asked for.
        $span->setData($data);
    }

    /**
     * Marks the open span with a status. Private because the only status this
     * platform sets deliberately is the failure one, and it sets it from the
     * catch above rather than from a call site.
     */
    private static function status(SpanStatus $status): void
    {
        SentrySdk::getCurrentHub()->getSpan()?->setStatus($status);
    }
}
