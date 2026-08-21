import { acceptOffer, declineOffer } from '../api/endpoints';
import { ApiClient } from '../api/client';
import { readSession } from '../auth/tokenStore';
import { API_BASE_URL } from '../config';
import { hideCallNotification } from './callNotification';
import { claimAnswer, outcomeOf, type OfferEvent, type OfferOutcome } from './offerEvent';

/**
 * Answers a job from the notification itself (ADR-0049 §6).
 *
 * ## This overrides a written decision, and the override is the owner's
 *
 * ADR-0025 and ADR-0046 both refused to let a driver accept from the
 * notification shade, on one argument: it needs *"a background task holding a
 * token it fetched itself, which is a different threat model than ADR-0022
 * reasoned about"*. The owner was shown that reasoning and chose the direct
 * answer anyway, for a reason worth recording — a driver at the wheel who
 * taps Accept and then waits several seconds for a cold app launch before the
 * job is actually theirs has, in a forty-five second window, spent a tenth of
 * it watching a splash screen.
 *
 * ## What the threat model actually is now, having looked
 *
 * The concern is a credential read outside a signed-in app. Two things bound
 * it, and neither existed when the original clause was written:
 *
 * - **The token is read from the same keystore the app reads**, through the
 *   same `readSession`, not from a copy this path keeps. Signing out deletes
 *   it, and this then finds nothing and does nothing (ADR-0022's scoping is
 *   untouched: it is a driver-scoped token either way).
 * - **The only thing reachable with it here is answering an offer** that this
 *   handset was itself sent. Not the trip list, not the wallet, not the
 *   profile — the two calls below are the whole surface.
 *
 * What is genuinely given up: a handset unlocked by somebody who is not the
 * driver can accept or decline a job from the lock screen without a
 * passcode. That is the same exposure a phone call's Answer button has, it is
 * the price of the feature the owner asked for, and it is written here rather
 * than discovered later.
 */

/**
 * A client with no React around it.
 *
 * Built per call rather than kept at module scope, because this runs in a
 * process that may have been created for one button press and torn down
 * immediately after — a cached client would be an object graph kept alive for
 * a second press that will never come.
 *
 * `getToken` reads the keystore each time. No `onUnauthenticated`: there is no
 * session layer up to tell, and a 401 here means the driver signed out
 * somewhere else, which is not an error worth surfacing on a lock screen.
 */
async function clientForAnswer(): Promise<ApiClient | null> {
  const session = await readSession();

  if (session === null) {
    return null;
  }

  return new ApiClient({ baseUrl: API_BASE_URL, getToken: () => session.token });
}

/**
 * Acts on a notification event, whatever state the app is in.
 *
 * Returns the outcome it acted on so the caller can route afterwards — the
 * foreground handler refetches and the background one does not, because there
 * is no query client in a process the OS built for a button.
 *
 * **Never throws.** It is called from notifee's background handler, where an
 * unhandled rejection is reported to the OS as the app misbehaving during a
 * headless task; do it often enough and Android stops running them.
 */
export async function handleOfferEvent(event: OfferEvent): Promise<OfferOutcome> {
  const outcome = outcomeOf(event);

  if (outcome.kind === 'ignore' || outcome.kind === 'open') {
    return outcome;
  }

  // Guarded before the request, not after. `getInitialNotification()` reports
  // the same press that the event stream already delivered — see
  // `claimAnswer`, which documents the double-accept this closes.
  if (!claimAnswer(outcome)) {
    return { kind: 'ignore' };
  }

  // **The notification goes first, before the network.** The driver has
  // answered; the card is now a stale control with a live Accept button on
  // it, and every further second of it is an invitation to press the same
  // thing twice. Waiting for the server would leave it there for the whole
  // round trip, which on a bad connection is the fifteen seconds the API
  // client allows.
  await hideCallNotification(outcome.offerId);

  try {
    const api = await clientForAnswer();

    if (api === null) {
      // Signed out between the push and the press. Nothing to answer with,
      // and nothing to tell anyone — this handset no longer belongs to that
      // driver's session (ADR-0025 §4).
      return { kind: 'ignore' };
    }

    if (outcome.kind === 'accept') {
      await acceptOffer(api, outcome.offerId);
    } else {
      await declineOffer(api, outcome.offerId);
    }

    return outcome;
  } catch {
    // **Deliberately silent, and the silence is load-bearing here.**
    //
    // Every failure is one the driver cannot act on from a lock screen: the
    // clock ran out, another driver was faster, the radio was in a dead zone.
    // ADR-0025 §3 is what makes that acceptable rather than lossy — the offer
    // list is the truth, the app polls it, and a driver who opens the app
    // finds either the job on their trip list or nothing.
    //
    // The one thing that must not happen is a rejected promise escaping into
    // a headless task. See the note on this function.
    return { kind: 'ignore' };
  }
}
