import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

import { isApiError } from '../api/errors';
import { OfferScreen } from '../screens/OfferScreen';
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

  // The same poll `HomeScreen` and `TodayScreen` read. React Query hands all
  // three the one in-flight request, so mounting this costs no extra traffic
  // — and it keeps running when the driver is on a screen that does not
  // itself ask for offers, which is the entire point.
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
      onAccept={() => void answer(accept.mutateAsync(offer.id))}
      onDecline={() => void answer(decline.mutateAsync({ offerId: offer.id }))}
      // Dismissing leaves the clock running rather than declining. A driver
      // who wants a moment to look at the map has not said no, and turning
      // "not now" into a decline would cost them a fare they never refused —
      // the job still sits on the Today screen until it expires.
      onDismiss={() => setDismissed(offer.id)}
    />
  );
}
