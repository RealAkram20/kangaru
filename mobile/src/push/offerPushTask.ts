import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { ApiClient } from '../api/client';
import { readSession } from '../auth/tokenStore';
import { API_BASE_URL } from '../config';
import { hideCallNotification } from './callNotification';
import { loadNotifications } from './expoNotifications';
import { dismissPlainPush, raiseOfferCall } from './offerCall';
import { pushDataFromTaskPayload } from './offerPushPayload';
import { intentFrom } from './routing';

/**
 * The call screen for a driver whose app is not running.
 *
 * ## The gap this closes, stated exactly
 *
 * The incoming-call notification — the one with Accept and Decline on it, the
 * one that loops its ring — is **built in JavaScript** by
 * `showCallNotification`. Until this file existed, the only two things that
 * called it lived inside the React tree: `PushRouter` and `OfferPresenter`.
 * So the feature had a precondition nobody had written down as a limit:
 * *the app's process must already be running.*
 *
 * On duty that is usually true, and deliberately so — ADR-0046 §1's location
 * foreground service holds the process through a locked screen and a closed
 * app, and that is why the feature works at all today. But the service is
 * exactly what an OEM battery manager kills first on the Tecno, Infinix and
 * Xiaomi handsets this fleet runs, and when it is gone the driver gets the
 * server's plain push from `offers.v2`: no buttons, and a channel sound that
 * plays **once**, because `loopSound` lives on the call notification and
 * nothing else.
 *
 * That single ring is the field-visible signature of this gap, and it is what
 * the owner reported.
 *
 * ## The honest limit, which the device test exists to settle
 *
 * `expo-notifications` says a background task runs "in foreground, background,
 * or terminated" — and then narrows it: *"When the app is terminated, only a
 * Headless Background Notification triggers the task execution."* A headless
 * notification is a push with no title and no body, which this platform
 * already knows how to send (`KangaruNotification::pushIsSilent`).
 *
 * **And that is where an unresolved contradiction sits.** This repo's own note
 * on `pushIsSilent` records the opposite finding: *"Android does not hand a
 * data-only message to a terminated process (expo/expo#38223)"*. If that is
 * still true on SDK 57, this task cannot fire for a terminated app no matter
 * what the server sends, and the fix is `@react-native-firebase/messaging`'s
 * `setBackgroundMessageHandler` instead — a native dependency and a bigger
 * change.
 *
 * Both statements cannot be true. This file is the cheap way to find out
 * which is: it is the half that is needed under either answer, and until it
 * exists there is nothing on the handset to test.
 *
 * **So do not read the existence of this file as the feature working.** It is
 * proven by a handset with the app force-stopped and a real offer, and by
 * nothing else.
 *
 * ## What it does *not* change
 *
 * The server push still sends, still rings, still shows its banner. This is an
 * upgrade applied on arrival, exactly as `callNotification.ts` argues — the
 * floor stays the floor.
 */

/**
 * The name the OS knows this task by.
 *
 * Changing it orphans any task already registered on a handset in the field,
 * which then sits in `expo-task-manager`'s registry under a name with no code
 * behind it. Same rule, and same reason, as `PRESENCE_TASK`.
 */
export const OFFER_PUSH_TASK = 'kangaruride.driver.offer-push';

/**
 * Defined at module scope, and that is load-bearing.
 *
 * `TaskManager.defineTask` has to run during the bundle's evaluation, before
 * React mounts anything, because the operating system starts this app *into*
 * the task — that is the entire point of it. A task defined inside a
 * `useEffect` does not exist at the only moment it is needed, and the symptom
 * is an `expo-task-manager` warning in logcat that nobody reads.
 *
 * `index.ts` imports this file for that side effect. A tidy-up that removes
 * the import as unused fails no test, no typecheck and no lint run.
 */
TaskManager.defineTask(OFFER_PUSH_TASK, async ({ data }) => {
  try {
    await handleOfferPush(data);
  } catch {
    /*
     * **A headless task may never throw.** There is no error boundary here and
     * no screen to show anything on — an escaping rejection is a crash in a
     * process the driver cannot see, triggered by a payload from a server that
     * may be newer than this build.
     *
     * What is lost is the upgrade. The plain push has already rung, and the
     * offer is on `GET /me/offers` for the moment the driver opens the app.
     */
  }
});

/**
 * Everything the task does, where it can be read.
 *
 * Separate from `defineTask` only so the body is not buried inside a
 * registration call — the callback shape is plumbing and this is the
 * judgement.
 */
async function handleOfferPush(payload: unknown): Promise<void> {
  const intent = intentFrom(pushDataFromTaskPayload(payload));

  if (intent.kind === 'ignore' || intent.kind === 'open_trip') {
    // A trip assignment has no call screen and no urgency measured in
    // seconds. It is `PushRouter`'s to route when the driver opens the app,
    // and waking a headless context to do nothing with it would spend a
    // driver's battery on a notification Android has already shown.
    return;
  }

  /*
   * One line, once per offer push, and it is emitted **before** every guard
   * below rather than after them.
   *
   * This feature's entire history is silent failure — an empty `device_tokens`
   * table for thirty-eight offers, a channel the server named and the app never
   * created, a full-screen intent Android downgrades without a word. A log line
   * placed after the guards would make "the task never ran" and "the task ran
   * and declined to act" produce identical evidence: nothing. They need
   * completely different fixes, so they must not look the same in logcat.
   *
   * The app state is in it for the same reason. If a headless start ever
   * reports `active` — plausible, since a reused React context keeps its
   * lifecycle state — the guard below would silently skip every offer, and this
   * line is the only thing that would say so.
   *
   * `observability.ts` captures `console.warn` as a Sentry breadcrumb, so this
   * is also the only evidence that will exist when the task fires on a driver's
   * handset rather than on a desk.
   */
  console.warn('offer.push_task', intent.kind, intent.offerId, AppState.currentState);

  /*
   * **The app is on screen, so this is not the surface that owns the offer.**
   *
   * `offerSurface.ts` holds the rule in one sentence: whichever surface the
   * driver can actually see carries the offer, and the other is taken down.
   * With the app active that is `OfferBanner`, already painted by
   * `OfferPresenter` and already ringing from the app's own player.
   *
   * The task is called on arrival in every app state, not only in the
   * background, so without this a driver looking straight at the offer would
   * get a second one over the top of it — two Accept buttons for one job,
   * which is the double answer `claimAnswer` exists to catch.
   */
  if (AppState.currentState === 'active') {
    return;
  }

  if (intent.kind === 'withdraw_offer') {
    // The job is gone — taken, cancelled, or expired at the server. Both
    // surfaces come down, and the call screen first: a driver holding a phone
    // that is ringing for a job nobody holds is the worst version of this
    // feature, because its Accept button leads to "you were too late".
    await hideCallNotification(intent.offerId);
    await dismissPlainPush(intent.offerId);

    return;
  }

  const session = await readSession();

  /*
   * Signed out. A handset that acted on a push while signed out would be
   * acting on the *previous* driver's job (ADR-0025 §4) — and would put that
   * job's pickup on a lock screen anybody can read.
   *
   * There is deliberately no `onUnauthenticated` on the client below, for the
   * reason `PresenceTask` gives at the same line: that callback drives the
   * sign-out flow through `AuthProvider`, and there is no provider here.
   * Signing a driver out from a headless task, mid-shift, with no way for them
   * to see why, is worse than a push that quietly did nothing.
   */
  if (session === null) {
    return;
  }

  await raiseOfferCall(
    new ApiClient({ baseUrl: API_BASE_URL, getToken: () => session.token }),
    intent.offerId,
  );
}

/**
 * Tells the OS to run the task above when a push arrives.
 *
 * Defining a task and registering it are two separate things, and the split is
 * not obvious: `defineTask` says what the name means, `registerTaskAsync` says
 * that notifications should trigger it. Without the second, the first is a
 * definition nothing ever calls — which fails silently, like everything else
 * on this path.
 *
 * Idempotent from the app's side: registering a name that is already
 * registered is what every launch after the first one does.
 *
 * Returns having done nothing in Expo Go, on a simulator and on any build
 * where `expo-notifications` cannot be loaded — the same rule `loadNotifications`
 * documents, and the same consequence: the driver keeps the plain push.
 */
export function registerOfferPushTask(): void {
  void (async () => {
    try {
      const Notifications = await loadNotifications();

      await Notifications?.registerTaskAsync(OFFER_PUSH_TASK);
    } catch {
      // An OEM that refuses the registration, or a runtime without the native
      // module. The offer path is unaffected: the push still rings and
      // `PushRouter` still raises the call screen whenever the app is alive,
      // which is the state this task exists to cover the absence of.
    }
  })();
}
