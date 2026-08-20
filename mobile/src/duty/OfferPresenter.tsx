import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

import { isApiError } from '../api/errors';
import { openPickup } from '../navigation/navigationRef';
import { OfferScreen } from '../screens/OfferScreen';
import { offerRingtone } from './offerRingtone';
import { useAcceptOffer, useDeclineOffer, useDuty, useOffers } from './queries';

/**
 * Puts a job in front of the driver, wherever they are in the app.
 *
 * ## Why this is an overlay and not a route
 *
 * An offer has a fifteen-second clock and arrives unannounced. It has to
 * appear over whatever the driver is doing — the account tab, a half-filled
 * odometer form, the trip list — and a navigator push cannot do that
 * honestly: pushed from the Account stack, the job would land *inside*
 * Account, and its back gesture would return to a password screen. Presenting
 * it from outside the navigator would need a container ref threaded through
 * the tree, and a ref that has not attached yet silently drops the one
 * notification in this app that must not be dropped.
 *
 * An absolutely-positioned sibling of the tab navigator has neither problem.
 * It paints above everything, it cannot desynchronise from a navigation
 * state, and it disappears when the offer does.
 *
 * Mounted next to `GpsController` and `PresenceController` for the same
 * reason they are: a driver who switches tabs must not stop being offered
 * work.
 *
 * ## What it deliberately does not do
 *
 * **It does not take the driver to the trip after an accept.** The overlay
 * closes and `HomeScreen`'s active-trip card is what they land on. Navigating
 * would need the container ref this component exists to avoid, and the accept
 * already answers loudly — the job leaves this screen and appears there. If a
 * driver ever reports landing somewhere confusing after accepting, that is
 * the moment to add the ref, and not before.
 */
export function OfferPresenter() {
  const { data: duty } = useDuty();
  const onDuty = duty?.on_duty ?? false;

  // **The app's only reader of the offer poll**, now that `TodayScreen` is
  // deleted and the home screen's bell counts unread mail instead. That is not
  // a loss of coverage but the point of this component: it is mounted outside
  // the navigator and keeps polling on every screen, where a screen-level
  // reader only ever asked while the driver happened to be standing on it.
  const { offers } = useOffers(onDuty);

  const accept = useAcceptOffer();
  const decline = useDeclineOffer();

  const [dismissed, setDismissed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Soonest to expire first — the server already orders them that way, and
  // showing anything else would have a driver answering a job with nine
  // seconds on it while one with three sat behind it.
  const offer = offers.find((candidate) => candidate.id !== dismissed) ?? null;

  const showing = offer !== null;

  // A stale error must not outlive the job it belonged to. Without this, a
  // driver who loses one race sees "somebody else took it" printed under the
  // *next* job they are offered.
  const shownId = useRef<number | null>(null);

  useEffect(() => {
    if (offer?.id !== shownId.current) {
      shownId.current = offer?.id ?? null;
      setError(null);
    }
  }, [offer?.id]);

  // **The ring, tied to the offer on screen and to nothing else.**
  //
  // Started here rather than inside `OfferScreen` because this component is
  // what knows an offer has arrived and what knows it has gone — the screen is
  // remounted on `key={offer.id}` and would restart the sound on every second
  // job while never being told about the first one ending.
  //
  // The cleanup uses `stopFor`, not `stop`: React runs the teardown for the
  // old offer *after* the new one has mounted, so an unconditional stop here
  // would silence the job now on screen. `ringtone.ts` documents that at
  // length, and it is covered there.
  // **Keyed on the id alone, and the window is read through a ref.**
  //
  // `expires_in_seconds` is a *different number on every poll* — it counts
  // down. Listing it as a dependency re-runs this effect every five seconds,
  // and because the cleanup and the restart both name the same offer, the
  // ring is stopped and started from the top over and over: audible as a
  // sound that never gets past its first chime. Exactly the failure
  // `useCountdown` documents for the countdown itself, one layer along.
  // Written in an effect rather than during render, for the reason
  // `PresenceController` gives: a ref assigned in the render body is invisible
  // to the React Compiler, which then cannot memoise this component at all.
  // Declared *before* the ring effect so it has the current window on the
  // mount that starts a sound — effects run in declaration order.
  const windowRef = useRef(0);

  useEffect(() => {
    windowRef.current = offer?.expires_in_seconds ?? 0;
  }, [offer?.expires_in_seconds]);

  const offerId = offer?.id ?? null;

  useEffect(() => {
    if (offerId === null) {
      return;
    }

    offerRingtone.start(offerId, windowRef.current);

    return () => offerRingtone.stopFor(offerId);
  }, [offerId]);

  // Android's back gesture dismisses rather than leaving the app. Registered
  // only while an offer is up, so it does not shadow the navigator's own
  // handling the rest of the time.
  useEffect(() => {
    if (!showing) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setDismissed(offer.id);

      return true;
    });

    return () => subscription.remove();
  }, [showing, offer?.id]);

  const answer = useCallback(
    async (act: Promise<unknown>) => {
      setError(null);

      // **Silence first, before the request goes anywhere.**
      //
      // The driver has answered; the ring has done its job and every further
      // second of it is noise over a decision already made. Waiting for the
      // server would leave it ringing through the round trip — which on a bad
      // connection is the fifteen seconds the API client allows — and a driver
      // who tapped Accept and is still being rung at reasonably concludes the
      // tap did not register.
      //
      // `stop`, not `stopFor`: this runs for whichever offer was answered, and
      // there is only ever one on screen.
      offerRingtone.stop();

      try {
        await act;
      } catch (caught) {
        // The server's own sentence, shown verbatim — it already knows
        // whether the clock ran out, another driver was faster, or a
        // dispatcher committed the van elsewhere (ADR-0024 §3). Inventing a
        // message here would be a second vocabulary for the same events.
        setError(
          isApiError(caught)
            ? caught.message
            : 'Could not reach the office. Check your connection and try again.',
        );
      }
    },
    [],
  );

  if (offer === null) {
    return null;
  }

  return (
    <OfferScreen
      // A new job is a new screen, not the old one with different words in
      // it. The remount is what re-seeds the countdown from the new offer's
      // own window — `useCountdown` documents why it will not reset itself —
      // and it re-plays the entrance, which is right: a second job arriving
      // should announce itself rather than silently swapping the address
      // under a driver who was mid-read.
      key={offer.id}
      offer={offer}
      // Which answer, not merely that one is in flight — see `OfferScreen`.
      pending={accept.isPending ? 'accept' : decline.isPending ? 'decline' : null}
      error={error}
      // Straight to the pickup once the office says yes. The server has
      // already put the trip on the road (`DispatchOfferService::accept`
      // moves it to `driver_en_route`), so the screen that opens is the one
      // for the leg the driver is now on — not the home card with the job
      // behind it, waiting for a second tap.
      onAccept={() =>
        void answer(accept.mutateAsync(offer.id).then((trip) => openPickup(trip.id)))
      }
      onDecline={() => void answer(decline.mutateAsync({ offerId: offer.id }))}
      // Dismissing leaves the clock running rather than declining. A driver
      // who wants a moment to look at the map has not said no, and turning
      // "not now" into a decline would cost them a fare they never refused —
      // the job still sits on the Today screen until it expires.
      //
      // The ring stops even though the offer does not. "Not now" is at least
      // a statement that the driver has heard it, and a phone that keeps
      // ringing after being told so is one whose sound gets switched off for
      // good. The effect's cleanup would catch this anyway once the overlay
      // unmounts; stopping here makes it immediate rather than a frame later.
      onDismiss={() => {
        offerRingtone.stop();
        setDismissed(offer.id);
      }}
    />
  );
}
