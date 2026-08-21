import { handleOfferEvent } from './offerAnswer';
import { loadNotifyKit } from './notifyKit';

/**
 * Wires the call notification's buttons to the API, from anywhere
 * (ADR-0049 §6).
 *
 * ## Why this is called from `index.ts` and not from a component
 *
 * The same reason `PresenceTask` is imported there, and its docblock makes
 * the argument in full: **the operating system cold-starts this app *into*
 * this handler.** A driver taps Accept on a locked phone; Android creates a
 * JavaScript runtime for that press; at that instant there is no component
 * tree, no navigator and no `useEffect` that has ever run. A handler
 * registered inside React is a handler that does not exist yet at the only
 * moment it is needed.
 *
 * A linter that removes the call as unused will not fail a test, a typecheck
 * or a lint run. It will produce two buttons that do nothing on a locked
 * phone and work perfectly on every desk.
 *
 * ## Why the import is still dynamic, and what that costs
 *
 * `notifyKit.ts` explains the rule: a static import of a native module takes
 * the whole app down in Expo Go rather than failing where it is used, and
 * this app has been bricked that way once already.
 *
 * The cost is that registration completes a microtask after the bundle
 * finishes evaluating rather than during it. That is inside the window —
 * notifee dispatches a queued background event after the runtime reports
 * ready, not during bundle evaluation — but it is a narrower margin than a
 * static import would give, and it is the first thing to suspect if a button
 * press is ever observed doing nothing from a cold start.
 *
 * On iOS, in Expo Go and on a simulator, `loadNotifyKit` returns null and this
 * is a no-op. There is no call notification on those, so there are no buttons
 * to wire.
 */
export function registerOfferBackgroundHandler(): void {
  void (async () => {
    const notifee = await loadNotifyKit();

    if (notifee === null) {
      return;
    }

    try {
      notifee.onBackgroundEvent(async ({ type, detail }) => {
        // Everything this handler needs, narrowed at the boundary — see
        // `OfferEvent`. A notification that is not one of ours yields
        // `ignore` and this returns having done nothing, which is how every
        // other notification in the platform passes through untouched.
        await handleOfferEvent({
          type,
          notificationId: detail.notification?.id,
          pressActionId: detail.pressAction?.id,
        });
      });
    } catch {
      // Registering twice, or a module that is present but not linked. The
      // offer is unaffected: it is on `GET /me/offers`, the app polls it, and
      // opening the app shows it. ADR-0025 §3.
    }
  })();
}
