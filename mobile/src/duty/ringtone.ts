/**
 * Ringing while an offer's clock runs (ADR-0046 §3), as a state machine over
 * injected ports.
 *
 * ## Why the logic is here and not in the component
 *
 * Because the way this fails is *not stopping*, and that is a failure a
 * component test cannot honestly reproduce. A ringtone that keeps playing
 * after the driver accepted — through the pickup, through the trip, until the
 * app is force-quit — is the single worst outcome available in this feature.
 * It is worse than never ringing: the driver has the job, the passenger is in
 * the car, and the phone will not stop.
 *
 * There are three concrete ways to reach it, and only the first is obvious:
 *
 * 1. Nobody called `stop`. Guarded by the callers, and by
 *    `expiresInSeconds` below.
 * 2. `stop` was called on a **different player** than the one that started,
 *    because a remount created a second one. `OfferPresenter` remounts
 *    `OfferScreen` on `key={offer.id}` by design, so this is not
 *    hypothetical — which is why the player is a module singleton and not a
 *    `useAudioPlayer` hook.
 * 3. The player outlived the JavaScript that owned it. Expo SDK 57 has an
 *    open bug of exactly this shape (expo/expo#47569): a looping player keeps
 *    playing after unmount, because `expo-modules-core` 57 holds a strong
 *    reference to the native shared object.
 *
 * The answer to all three is the same and is the point of this module: **a
 * ring is always bounded by a deadline set when it starts.** Even if every
 * caller forgets, and even if the release path is the one Expo is currently
 * getting wrong, it stops on its own a couple of seconds after the offer it
 * belongs to expired.
 */

export type RingtonePorts = {
  /** Begins playback from the top, looping. Must be idempotent. */
  play: () => void;
  /** Halts playback. Called more often than `play`, including redundantly. */
  halt: () => void;
  /** Starts the vibration pattern, if the driver has not turned it off. */
  buzz: () => void;
  /** Stops it. Safe to call when nothing is vibrating. */
  stillness: () => void;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
};

/**
 * How long past the offer's own expiry the backstop waits.
 *
 * Two seconds, not zero: the server's countdown and this device's timer drift
 * slightly, and cutting the ring off a beat *early* on a job the driver could
 * still have accepted would be a fare lost to a rounding error. Two seconds
 * of ringing past a dead offer is a much cheaper mistake than the reverse,
 * and both are far cheaper than not stopping at all.
 */
const BACKSTOP_GRACE_SECONDS = 2;

export class Ringtone {
  private timer: number | null = null;

  /**
   * Which offer is ringing. Not a boolean, because the interesting question
   * is *which* — a second offer arriving while the first rings must not be
   * silenced by the first one's cleanup running afterwards, which is exactly
   * what a boolean lets happen.
   */
  private offerId: number | null = null;

  constructor(private readonly ports: RingtonePorts) {}

  ringingFor(): number | null {
    return this.offerId;
  }

  /**
   * Rings for one offer, for at most as long as it can live.
   *
   * Starting for the offer that is already ringing is a no-op rather than a
   * restart. `OfferPresenter` re-renders on every five-second poll with a
   * fresh copy of the same offer, and restarting there would chop the ring
   * back to its first note forever — audible as a stutter, and it never
   * reaches the second chime.
   */
  start(offerId: number, expiresInSeconds: number): void {
    if (this.offerId === offerId) {
      return;
    }

    // A different offer takes over cleanly: the old deadline is dropped so it
    // cannot fire later and silence the new job's ring.
    this.clearBackstop();

    this.offerId = offerId;
    this.ports.play();
    this.ports.buzz();

    // **The backstop.** Armed at `start`, from the same number the countdown
    // is seeded with, so silence does not depend on anybody remembering to
    // ask for it. Clamped at both ends: a zero or negative window still gets
    // a deadline rather than none, and an absurd one from a bad payload
    // cannot ring for an hour.
    const seconds = Math.min(
      Math.max(0, expiresInSeconds) + BACKSTOP_GRACE_SECONDS,
      120,
    );

    this.timer = this.ports.setTimer(() => {
      this.timer = null;
      this.stop();
    }, seconds * 1000);
  }

  /**
   * Silence, unconditionally.
   *
   * Deliberately not guarded on `offerId` being set. It is called from
   * cleanup paths that cannot know whether a ring was ever started — an
   * unmount, a sign-out, an app going to the background — and the halt ports
   * are required to tolerate that. A guard here would turn "stop whatever is
   * happening" into "stop only what I believe is happening", and the belief
   * is the part that goes wrong.
   */
  stop(): void {
    this.clearBackstop();
    this.offerId = null;
    this.ports.halt();
    this.ports.stillness();
  }

  /**
   * Stops only if *this* offer is the one ringing.
   *
   * For the caller that answered a specific job. Without it, a stale cleanup
   * from the previous offer — React runs effect teardown for the old value
   * after the new one has mounted — silences the ring for the job now on
   * screen, and the driver watches a countdown in silence.
   */
  stopFor(offerId: number): void {
    if (this.offerId === offerId) {
      this.stop();
    }
  }

  private clearBackstop(): void {
    if (this.timer !== null) {
      this.ports.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
