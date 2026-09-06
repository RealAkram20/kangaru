import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DispatchOffer } from '../api/types';
import { isApiError } from '../api/errors';
import { openPickup } from '../navigation/navigationRef';
import { hideCallNotification, showCallNotification } from '../push/callNotification';
import { openedFromCallScreen } from '../push/callLaunch';
import { OfferScreen } from '../screens/OfferScreen';
import { OfferBanner } from './OfferBanner';
import { offerRingtone } from './offerRingtone';
import { presentOffer } from './offerSurface';
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
  const insets = useSafeAreaInsets();
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

  /**
   * Whether the job is showing as the full screen or as the banner
   * (ADR-0049 §5).
   *
   * Starts collapsed. A driver with the app open is doing something, and a
   * job they may well decline should not throw that away — `OfferBanner`
   * carries the four facts the decision usually turns on and answers in one
   * tap. Tapping it opens the whole offer for the times it does not.
   */
  const [expanded, setExpanded] = useState(false);

  // Soonest to expire first — the server already orders them that way, and
  // showing anything else would have a driver answering a job with nine
  // seconds on it while one with three sat behind it.
  const offer = offers.find((candidate) => candidate.id !== dismissed) ?? null;

  const showing = offer !== null;

  /**
   * The job on screen, as an id.
   *
   * Read out here rather than as `offer?.id` inside each dependency array: the
   * effects below deliberately key on the *identity* of the offer and not on
   * the object, because `expires_in_seconds` is a different number on every
   * five-second poll. Naming it once is what lets the dependency arrays say
   * exactly what they mean instead of being lint exceptions.
   */
  const showingOfferId = offer?.id ?? null;

  // A stale error must not outlive the job it belonged to. Without this, a
  // driver who loses one race sees "somebody else took it" printed under the
  // *next* job they are offered.
  const shownId = useRef<number | null>(null);

  useEffect(() => {
    if (offer?.id !== shownId.current) {
      shownId.current = offer?.id ?? null;
      setError(null);

      // A new job is a new decision, taken at the size the driver is used to.
      // Without this, a second offer arriving while the first was expanded
      // would inherit the full screen — which is the right surface for a
      // locked phone and the wrong one for a driver who is now holding the
      // app open and mid-read.
      setExpanded(false);
    }
  }, [offer?.id]);

  /**
   * **The lock-screen case, and the only thing that expands without a tap.**
   *
   * Android brought this app up because a job was offered — the driver was
   * woken by a ringing phone in a cradle and has nothing else on screen to
   * protect. `OfferScreen` is the right surface for that: it is the call
   * screen the full-screen intent exists to show.
   *
   * Asked once per process, and only acted on while an offer is actually up:
   * a driver who let the first job expire and opened the app twenty minutes
   * later must not have the *next* one open expanded because of how the
   * process happened to start.
   */
  useEffect(() => {
    if (offer === null) {
      return;
    }

    let cancelled = false;

    void openedFromCallScreen().then((launchedFor) => {
      if (!cancelled && launchedFor === offer.id) {
        setExpanded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [offer]);

  /**
   * **Hands the offer between the two surfaces as the app comes and goes.**
   *
   * The rule is `offerSurface()`'s: whichever surface the driver can see is the
   * one carrying the job, and the other is taken down. A notification for a
   * screen somebody is standing on is clutter, and worse than clutter — its
   * Accept button is a second, slower way to answer a job they are already
   * answering, and pressing both is the double answer `claimAnswer` exists to
   * catch.
   *
   * ## What this used to be, and the bug it had
   *
   * One unconditional `hideCallNotification(showingOfferId)`, guarded on
   * nothing but the component being mounted. **`OfferPresenter` stays mounted
   * while the app is backgrounded**, so the guard was answering "is there an
   * offer" when it meant "is the driver looking at it".
   *
   * The consequence sat on the exact path this feature exists for.
   * `PushRouter.act()` fires `invalidateQueries(['offers'])` and `raiseCall()`
   * together; the refetch re-renders this component, the effect ran, and the
   * call notification `raiseCall` had just put on a locked phone was cancelled
   * by a page nobody could see. Racy, so it would have worked on some handsets
   * and not others, and it produces no error either way.
   *
   * ## And the half that was missing entirely
   *
   * Nothing ever raised the notification *from here*. The offer poll is the
   * only path that survives a lost or late push — but an offer it discovered
   * while the app was in a pocket was painted onto an overlay behind a dark
   * screen and shown to nobody. So the transition out of `active` now raises
   * the call, which is what makes the poll a genuine second path rather than a
   * foreground-only one.
   *
   * `showCallNotification` is idempotent on the offer and carries
   * `onlyAlertOnce`, so re-raising one that is already up replaces it in place
   * and does not buzz the handset again.
   *
   * Keyed on the id alone — `expires_in_seconds` changes on every poll, and
   * listing it would re-run this every five seconds (the same trap
   * `useCountdown` and the ring effect below both document). `offerRef` is what
   * lets the effect reach the current offer object without taking that
   * dependency.
   */
  const offerRef = useRef<DispatchOffer | null>(null);

  useEffect(() => {
    offerRef.current = offer;
  }, [offer]);

  /**
   * The offer's remaining window, read through a ref.
   *
   * `expires_in_seconds` is a **different number on every five-second poll** —
   * it counts down. Taking it as a dependency of the effect below would tear
   * the effect down and rebuild it every five seconds, and because the
   * teardown and the restart name the same offer the ring would be stopped and
   * started from the top over and over: audible as a sound that never gets
   * past its first chime. `useCountdown` documents exactly this trap for the
   * countdown itself.
   *
   * **Declared before the effect that reads it, and that ordering is
   * load-bearing.** Effects run in declaration order, so an update written
   * below would not have run yet on the mount that starts the first ring — and
   * `offerRingtone.start` would arm a zero-second deadline and fall silent
   * immediately.
   *
   * Written in an effect rather than in the render body for the reason
   * `PresenceController` gives: a ref assigned during render is invisible to
   * the React Compiler, which then cannot memoise this component at all.
   */
  const windowRef = useRef(0);

  useEffect(() => {
    windowRef.current = offer?.expires_in_seconds ?? 0;
  }, [offer?.expires_in_seconds]);

  useEffect(() => {
    if (showingOfferId === null) {
      return;
    }

    // The judgement lives in `presentOffer`, where it can be read and tested
    // without a query client, an auth provider and a duty poll standing behind
    // it. What is left here is the subscription, which is plumbing.
    //
    // `offerRef` rather than `offer` so the current object is re-read at the
    // moment the app state changes — a poll may have replaced it since this
    // effect was set up, and `presentOffer` documents why raising a stale one
    // onto a lock screen is the failure worth guarding.
    const present = (state: AppStateStatus) =>
      presentOffer(state, showingOfferId, offerRef.current, {
        show: (job) => void showCallNotification(job),
        hide: (id) => void hideCallNotification(id),
        // The window comes from the ref for the reason the ring effect below
        // documents at length: `expires_in_seconds` is a different number on
        // every five-second poll, so reading it as a dependency would restart
        // the sound from its first chime over and over.
        ring: (id) => offerRingtone.start(id, windowRef.current),
        silence: (id) => offerRingtone.stopFor(id),
      });

    present(AppState.currentState);

    const subscription = AppState.addEventListener('change', present);

    return () => {
      subscription.remove();

      // Both surfaces go quiet together. `stopFor`, not `stop`, because React
      // runs this teardown *after* the next offer's effect has already
      // started its ring — an unconditional stop here would silence the job
      // now on screen. `offerRingtone` documents that ordering trap in full.
      offerRingtone.stopFor(showingOfferId);

      // The job this effect was raised for is answered, expired or replaced,
      // so its notification goes with it. **Keyed by the captured id**, which
      // is what makes this safe against React running the old teardown after
      // the new effect has already raised the next offer — the same ordering
      // trap `offerRingtone.stopFor` exists for, one surface along.
      //
      // `timeoutAfter` on the notification is still the guarantee; this is the
      // courtesy that makes a dead job leave the lock screen at the moment it
      // dies rather than at the end of its window.
      void hideCallNotification(showingOfferId);
    };
  }, [showingOfferId]);

  /*
   * **The ring used to live here, in an effect keyed on the offer alone.**
   *
   * That was right when the app's own player was the only thing that could
   * make a noise. It is wrong now: `offers.call.v2` carries `offer_ring.wav`
   * and the call notification loops it, so a backgrounded app running this
   * effect as well would play two copies of the same ringtone —
   * unsynchronised, and neither stopping when the other did.
   *
   * The ring is now one of `presentOffer`'s four ports, decided by the same
   * rule as the rest: **in the app, the app's player; outside it, the
   * channel's.** Whichever surface the driver can see is the one making the
   * sound, and there is exactly one.
   */

  // Android's back gesture dismisses rather than leaving the app. Registered
  // only while an offer is up, so it does not shadow the navigator's own
  // handling the rest of the time.
  useEffect(() => {
    if (!showing) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Back unwinds one step at a time, which is what back means everywhere
      // else in the app. From the full screen it returns to the banner — the
      // job is still live and the driver has not answered it — and only from
      // the banner does it get out of the way entirely.
      if (expanded) {
        setExpanded(false);
      } else {
        setDismissed(offer.id);
      }

      return true;
    });

    return () => subscription.remove();
  }, [showing, expanded, offer?.id]);

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

        // **An answer that failed needs explaining, and the banner has no
        // room to explain.** It carries four facts and two buttons by design;
        // there is nowhere on it to say *"another driver was faster"* without
        // pushing the pickup off the card.
        //
        // So a failure opens the full offer, which has an error line and the
        // countdown still running on it. The driver sees what happened and,
        // if there is time left, can answer again. Doing nothing here would
        // leave them looking at a banner whose button they pressed and which
        // did not visibly change.
        setExpanded(true);
      }
    },
    [],
  );

  if (offer === null) {
    return null;
  }

  // **The answers, written once and passed to whichever surface is showing.**
  //
  // Both call the same mutations with the same follow-through, because they
  // are the same act — the banner is not a lesser accept. Defining them here
  // rather than inline in each branch is what stops the two drifting, which
  // is the failure a driver would find first and understand last.
  const acceptThis = () =>
    void answer(accept.mutateAsync(offer.id).then((trip) => openPickup(trip.id)));

  const declineThis = () => void answer(decline.mutateAsync({ offerId: offer.id }));

  // **Pending is scoped to *this* offer, not to the mutation.** The mutation
  // objects outlive the `key={offer.id}` remount below, so an answer still in
  // flight for the previous job — a slow round trip, a tap made as the signal
  // dropped — would otherwise arrive at the next offer as `isPending`,
  // rendering it with a spinning Accept and a disabled Decline the driver
  // never pressed. `variables` says which offer an answer was actually for.
  const pending =
    accept.isPending && accept.variables === offer.id
      ? 'accept'
      : decline.isPending && decline.variables?.offerId === offer.id
        ? 'decline'
        : null;

  if (!expanded) {
    return (
      <View style={[styles.bannerSlot, { top: insets.top + 8 }]} pointerEvents="box-none">
        <OfferBanner
          // A new job is a new banner, not the old one with different words in
          // it — the same reason `OfferScreen` is keyed below.
          key={offer.id}
          offer={offer}
          pending={pending}
          onAccept={acceptThis}
          onDecline={declineThis}
          onOpen={() => setExpanded(true)}
        />
      </View>
    );
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
      pending={pending}
      error={error}
      // Straight to the pickup once the office says yes. The server has
      // already put the trip on the road (`DispatchOfferService::accept`
      // moves it to `driver_en_route`), so the screen that opens is the one
      // for the leg the driver is now on — not the home card with the job
      // behind it, waiting for a second tap.
      onAccept={acceptThis}
      onDecline={declineThis}
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

const styles = StyleSheet.create({
  /**
   * Where the banner sits: pinned to the top, over everything, inset from the
   * gutters.
   *
   * **Top, not bottom, and not centred.** It is standing in for a heads-up
   * notification, and every heads-up on both platforms comes from the top —
   * a driver who has seen one before knows where to look without being
   * taught. Centring it would read as a modal, which is a thing you must
   * answer; this is a thing you may ignore, and it should sit where ignorable
   * things sit.
   *
   * `pointerEvents="box-none"` on the wrapper is load-bearing: without it this
   * view spans the width of the screen and swallows taps on whatever is
   * underneath it, so a driver with an offer up could not scroll their trip
   * list. The banner itself still takes its own presses.
   *
   * `top` is set at the call site from the safe-area inset, because a notch is
   * a runtime measurement rather than a token.
   */
  bannerSlot: {
    position: 'absolute',
    left: 12,
    right: 12,
    // Above the tab bar, the drawer scrim and any screen-level modal. The
    // navigator paints in the order it is declared and this is declared last,
    // but an explicit index is what keeps that true if somebody reorders
    // `RootNavigator`.
    zIndex: 100,
    elevation: 100,
  },
});
