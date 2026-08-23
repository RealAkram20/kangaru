import * as Sentry from '@sentry/react-native';

/**
 * Performance tracing for the driver app (ADR-0054 §4).
 *
 * ## The driver app has been paying for this and sending nothing
 *
 * `startObservability()` sets `tracesSampleRate` and has done since the SDK
 * went in. That switch decides *how many* transactions are sent, not whether
 * any exist — and a React Native app produces none on its own. Nothing called
 * `Sentry.wrap`, nothing registered a navigation container, so the SDK had
 * nowhere to hang the app-start measurement or a screen change, and the
 * handset's contribution to the trace data has been empty.
 *
 * That is the gap this file closes, and the reason it matters here more than
 * on the other two apps: the worklog entry on *frozen screens and dead
 * buttons* was written from a driver's account of the app because there was
 * no measurement to write it from.
 *
 * ## Why the setup lives here rather than in `Sentry.init`
 *
 * The documented way to add the navigation integration is an `integrations:`
 * entry in `Sentry.init`. `Sentry.addIntegration` after init is equivalent —
 * the client keeps a mutable integration list and sets the new one up
 * immediately — and it keeps every line of tracing in one file instead of
 * splitting it across `observability.ts`, which another agent owns.
 *
 * Both calls below are safe with no client, which is how development and the
 * Jest environment run: `addIntegration` warns and returns, and `startSpan`
 * hands back a non-recording span. There is no DSN check anywhere in this
 * file and no call site needs one.
 */

/**
 * Screen changes as transactions, built by {@see startTracing}.
 *
 * **Nothing in this module runs at import time, and that is not a
 * preference.** `Sentry.reactNavigationIntegration` is re-exported through
 * two layers of the SDK's own barrel files, and calling it while a module
 * graph is still being evaluated finds it undefined — which is exactly what
 * happened, in the Jest environment, the moment `outbox.ts` imported this
 * file. It resolves cleanly once evaluation has finished, so the integration
 * is constructed when tracing is switched on rather than when this module is
 * loaded.
 *
 * Null in every Jest suite and on any path that never calls `startTracing`,
 * which is what makes {@see registerNavigationForTracing} a no-op there.
 */
let navigationTracing: ReturnType<typeof Sentry.reactNavigationIntegration> | null = null;

/**
 * Switches tracing on. Called from `index.ts` immediately after
 * `startObservability()`, before React mounts anything.
 *
 * `enableTimeToInitialDisplay` is the option worth having and the one this
 * app was built to need: it measures from the navigation dispatch to the
 * first frame of the new screen, which is the exact interval a driver
 * describes as *"it hangs when I tap the job"*. Without it a transaction ends
 * when the route is mounted, which is before anything has been drawn.
 *
 * `ignoreEmptyBackNavigationTransactions` is left at its default (on). A
 * driver going back to a screen already in memory produces a transaction with
 * nothing in it, and this app's navigation is mostly backwards — out of a
 * trip, out of the drawer, out of Earnings.
 */
export function startTracing(): void {
  navigationTracing = Sentry.reactNavigationIntegration({
    enableTimeToInitialDisplay: true,
  });

  Sentry.addIntegration(navigationTracing);
}

/**
 * Hands the navigation container to the integration.
 *
 * **This cannot be done from a module, and that is why `RootNavigator` has an
 * `onReady` prop it would not otherwise have.** The SDK reads `ref.current`
 * at the moment it is called and warns if it is null — it does not hold the
 * ref and wait. `navigationRef.current` is null until the container mounts,
 * so the only correct moment is the one React tells us about.
 *
 * The ref is a parameter rather than an import, and that is not style: this
 * module is imported by `outbox.ts`, whose suite is deliberately pure
 * TypeScript over injected ports. Importing `navigationRef` here would pull
 * `@react-navigation/native` into that suite for no reason.
 */
export function registerNavigationForTracing(navigationContainerRef: unknown): void {
  navigationTracing?.registerNavigationContainer(navigationContainerRef);
}

/**
 * Runs `work` inside a span, and returns exactly what it returned.
 *
 * ## Where a manual span earns its place on a handset
 *
 * The SDK already traces every `fetch` and every screen change. So a span
 * here is worth adding only where **neither of those is what the driver is
 * waiting on** — a native call that blocks the button, or a piece of
 * background work that no screen change bracketed. Wrapping an API call would
 * only duplicate a span the SDK already produced.
 *
 * ## What happens when there is no transaction open
 *
 * `startSpan` makes this a **root** span — its own transaction — rather than
 * discarding it. That is deliberate and it is the point for the outbox: a
 * sync that fires on a NetInfo change while the app is backgrounded belongs
 * to no screen and would otherwise be the one piece of work in this app that
 * can never be measured.
 *
 * Rejections propagate untouched, with the span marked failed by the SDK.
 * Every caller's existing error handling still runs — a driver app that
 * swallowed a failed sync because it was being measured would be worse than
 * one that never measured it.
 *
 * @param op dot-namespaced and stable — `outbox.drain`, `duty.go_online`.
 *   Sentry groups by this, so nothing that varies per call belongs in it.
 * @param name the human half, shown on the transaction or the waterfall row.
 */
export function traced<T>(op: string, name: string, work: () => Promise<T>): Promise<T> {
  return Sentry.startSpan({ op, name }, work);
}

/**
 * Adds attributes to whatever span is open, for the facts only known once the
 * work is done — how many items drained, whether the OS said no.
 *
 * A no-op when nothing is being traced, which is the usual case: no DSN in
 * development, and nine transactions in ten are not sampled.
 */
export function annotate(data: Record<string, string | number | boolean>): void {
  Sentry.getActiveSpan()?.setAttributes(data);
}
