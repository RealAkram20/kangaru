import type { DispatchOffer } from '../api/types';
import { offerSurface, presentOffer } from './offerSurface';

/**
 * The boundary between the two surfaces a job offer can appear on.
 *
 * These four lines are the whole of the rule, and every one of them stands for
 * a bug that was live: the order request page cancelling a lock-screen
 * notification it could not be seen next to, and a backgrounded app finding an
 * offer by poll and showing it to nobody.
 */

it('gives the job to the order request page while the driver is in the app', () => {
  expect(offerSurface(true, 'active')).toBe('in_app');
});

it('gives the job to the notification the moment the app is not on screen', () => {
  /*
   * **The half that did not exist.** `OfferPresenter` stays mounted while
   * backgrounded, so an offer found by the poll was painted onto an overlay
   * behind a dark screen. Outside the app the notification is the only surface
   * a driver can actually be reached on — which is the owner's own framing of
   * this feature, and now the code's.
   */
  expect(offerSurface(true, 'background')).toBe('notification');
});

it('treats an iOS transitional state as not-visible', () => {
  /*
   * `inactive` is iOS-only — a control centre pulled down, the app switcher,
   * an incoming call. Safe to route to the notification because there is no
   * call notification on iOS at all: `canShowCallScreen()` is Android-only and
   * `showCallNotification` returns having done nothing there.
   *
   * Asserted rather than left to chance, because the alternative reading is
   * wrong in the expensive direction — an offer arriving while the app was
   * half-backgrounded would clear its own notification and show nothing.
   */
  expect(offerSurface(true, 'inactive')).toBe('notification');
});

it('shows the job on neither surface when there is no job', () => {
  /*
   * Both states, because "no offer" must not depend on where the driver is.
   * A `none` that varied by app state would be a notification left on a lock
   * screen for a job that has been answered, with a live Accept button on it.
   */
  expect(offerSurface(false, 'active')).toBe('none');
  expect(offerSurface(false, 'background')).toBe('none');
});

// -- Acting on the decision (ADR-0049 §5) ---------------------------------

/**
 * Only the two fields `presentOffer` reads. Written as a partial rather than a
 * whole `DispatchOffer` because a full fixture here would be forty fields of
 * fare, package and payment detail that this function never looks at — and the
 * next person changing `DispatchOffer` would have to update a fixture that
 * proves nothing.
 */
function offer(id: number): DispatchOffer {
  return { id } as DispatchOffer;
}

function ports() {
  return { show: jest.fn(), hide: jest.fn(), ring: jest.fn(), silence: jest.fn() };
}

it('takes the notification down when the driver is looking at the app', () => {
  const spy = ports();

  presentOffer('active', 7, offer(7), spy);

  expect(spy.hide).toHaveBeenCalledWith(7);
  expect(spy.show).not.toHaveBeenCalled();
});

it('raises the notification when the app is not on screen', () => {
  /*
   * **The path that did not exist**, and the reason the background poll is
   * worth running at all: an offer found while the phone is in a pocket has to
   * arrive on the one surface a driver can be reached on. Without this it was
   * painted onto an overlay behind a dark screen.
   */
  const spy = ports();
  const job = offer(7);

  presentOffer('background', 7, job, spy);

  expect(spy.show).toHaveBeenCalledWith(job);
  expect(spy.hide).not.toHaveBeenCalled();
});

it('never cancels the lock-screen notification from a backgrounded app', () => {
  /*
   * **The bug this whole module exists for, stated as an assertion.**
   *
   * `OfferPresenter` stays mounted while backgrounded, and its old guard was
   * "is there an offer" when it meant "is the driver looking at it". So
   * `PushRouter`'s `invalidateQueries` would re-render the page, the page would
   * call hide, and the call notification just raised on a locked phone was
   * cancelled by a surface nobody could see. Racy, silent, and only ever
   * visible on a handset.
   *
   * Mutation check: change `offerSurface(true, appState) === 'in_app'` in
   * `presentOffer` to `true` and this fails.
   */
  const spy = ports();

  presentOffer('background', 7, offer(7), spy);

  expect(spy.hide).not.toHaveBeenCalled();
});

it('will not put a stale offer on a lock screen', () => {
  /*
   * The gap between the app backgrounding and this running is however long the
   * OS took, and a poll may have replaced the object in it. A lock screen is
   * the one surface a driver cannot check against anything else, so a
   * superseded fare and pickup must not reach it.
   *
   * Nothing is raised and — deliberately — nothing is hidden either: the
   * notification for the job that *is* live belongs to whichever call names it.
   */
  const spy = ports();

  presentOffer('background', 7, offer(9), spy);

  expect(spy.show).not.toHaveBeenCalled();
  expect(spy.hide).not.toHaveBeenCalled();
});

// -- Exactly one thing makes a sound (ADR-0046 §2) -------------------------

it('rings from the app while the driver is in the app, and not from the channel', () => {
  const spy = ports();

  presentOffer('active', 7, offer(7), spy);

  expect(spy.ring).toHaveBeenCalledWith(7);
  expect(spy.show).not.toHaveBeenCalled();
});

it('silences the app player the moment the app is not on screen', () => {
  /*
   * **The double-ring this exists to prevent.** Since the ring moved onto
   * `offers.call.v2`, the call notification loops `offer_ring.wav` on its own.
   * `OfferPresenter` stays mounted while backgrounded, so an app-side player
   * left running would play a second, unsynchronised copy of the same
   * ringtone — and neither would stop when the other did.
   *
   * Mutation check: drop the `ports.silence(offerId)` line from `presentOffer`
   * and this fails.
   */
  const spy = ports();

  presentOffer('background', 7, offer(7), spy);

  expect(spy.silence).toHaveBeenCalledWith(7);
  expect(spy.ring).not.toHaveBeenCalled();
});

it('silences the app player even where no notification can be raised', () => {
  /*
   * `show` is a no-op on iOS, in Expo Go and on a simulator. The silence must
   * not be conditional on it: a ringtone still playing from a backgrounded app
   * with nothing on screen to explain it is worse than no sound at all.
   *
   * Modelled here as a stale offer, which is the one path that reaches the
   * notification branch and deliberately raises nothing.
   */
  const spy = ports();

  presentOffer('background', 7, offer(9), spy);

  expect(spy.silence).toHaveBeenCalledWith(7);
  expect(spy.show).not.toHaveBeenCalled();
});

it('raises nothing when the offer has gone but still answers the in-app case', () => {
  /*
   * `current` is null between a poll clearing the list and the effect being
   * torn down. Backgrounded there is nothing to raise; in the foreground the
   * hide must still happen, because taking a notification down is always safe
   * and leaving a wrong one up is not.
   */
  const backgrounded = ports();
  presentOffer('background', 7, null, backgrounded);
  expect(backgrounded.show).not.toHaveBeenCalled();
  expect(backgrounded.hide).not.toHaveBeenCalled();

  const active = ports();
  presentOffer('active', 7, null, active);
  expect(active.hide).toHaveBeenCalledWith(7);
});
