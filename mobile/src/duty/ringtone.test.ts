import { Ringtone, type RingtonePorts } from './ringtone';

/**
 * The ringtone, and mostly the ways it must stop.
 *
 * Weighted deliberately: one test that it rings, six that it goes quiet. A
 * ringtone that will not stop is the worst outcome this feature can produce —
 * the driver has accepted, the passenger is in the car, and the phone is
 * still going — and it is reachable through a remount, a stale effect
 * teardown, or the Expo SDK 57 player bug this module was shaped around.
 */

function ports(): RingtonePorts & { log: string[]; fire: (ms?: number) => void } {
  const log: string[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;

  return {
    log,
    play: () => log.push('play'),
    halt: () => log.push('halt'),
    buzz: () => log.push('buzz'),
    stillness: () => log.push('stillness'),
    setTimer: (callback, ms) => {
      const handle = next;
      next += 1;
      timers.set(handle, { callback, ms });
      log.push(`timer:${ms}`);

      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle);
      log.push('cleared');
    },
    /** Runs every timer still armed, as the clock reaching their deadline would. */
    fire: () => {
      for (const [handle, timer] of [...timers]) {
        timers.delete(handle);
        timer.callback();
      }
    },
  };
}

it('rings and buzzes for an offer', async () => {
  const p = ports();

  new Ringtone(p).start(41, 45);

  expect(p.log).toContain('play');
  expect(p.log).toContain('buzz');
});

it('does not restart on the poll that re-delivers the same offer', () => {
  // `OfferPresenter` re-renders every five seconds with a fresh copy of the
  // same job. Restarting there chops the ring back to its first note forever,
  // so it never reaches the second chime — audible as a stutter that never
  // resolves.
  const p = ports();
  const ringtone = new Ringtone(p);

  ringtone.start(41, 45);
  ringtone.start(41, 40);
  ringtone.start(41, 35);

  expect(p.log.filter((entry) => entry === 'play')).toHaveLength(1);
});

// -- Stopping ---------------------------------------------------------------

it('goes quiet on its own once the offer could no longer be live', () => {
  // **The guarantee this module exists for.** No caller stops it here at all.
  // Even so it must fall silent, because the three ways a stop goes missing —
  // a forgotten call, a remount stopping a different player, and the SDK 57
  // bug where a looping player outlives its owner — all look like this.
  //
  // Mutation check: delete the `setTimer` block in `start` and this fails.
  const p = ports();

  new Ringtone(p).start(41, 45);
  p.fire();

  expect(p.log).toContain('halt');
  expect(p.log).toContain('stillness');
});

it('arms that deadline just past the offer window, never before it', () => {
  // Cutting the ring off early on a job the driver could still accept is a
  // fare lost to a rounding error; ringing two seconds past a dead offer is
  // the cheaper mistake.
  const p = ports();

  new Ringtone(p).start(41, 45);

  expect(p.log).toContain('timer:47000');
});

it('still arms a deadline for a nonsense window, and never a runaway one', () => {
  const short = ports();
  new Ringtone(short).start(41, -5);
  expect(short.log).toContain('timer:2000');

  // A bad payload must not buy an hour of ringing.
  const long = ports();
  new Ringtone(long).start(42, 99_999);
  expect(long.log).toContain('timer:120000');
});

it('stops unconditionally, even when it was never started', () => {
  // Called from unmount, sign-out and backgrounding, none of which can know
  // whether a ring was running. A guard here would turn "stop whatever is
  // happening" into "stop only what I believe is happening", and the belief
  // is the part that goes wrong.
  const p = ports();

  new Ringtone(p).stop();

  expect(p.log).toContain('halt');
  expect(p.log).toContain('stillness');
});

it("lets a stale cleanup silence its own offer but not the one now ringing", () => {
  // React runs the teardown for the old value *after* the new one has
  // mounted. Without `stopFor` keying on the id, offer 41's cleanup silences
  // offer 42, and the driver watches a countdown run down in silence.
  const p = ports();
  const ringtone = new Ringtone(p);

  ringtone.start(41, 45);
  ringtone.start(42, 45);
  ringtone.stopFor(41);

  expect(ringtone.ringingFor()).toBe(42);
  expect(p.log).not.toContain('halt');

  ringtone.stopFor(42);

  expect(ringtone.ringingFor()).toBeNull();
  expect(p.log).toContain('halt');
});

it("drops the previous offer's deadline when a second job takes over", () => {
  // Otherwise offer 41's backstop fires mid-way through offer 42's window and
  // silences a job that is still live.
  const p = ports();
  const ringtone = new Ringtone(p);

  ringtone.start(41, 10);
  ringtone.start(42, 45);
  p.fire();

  // One deadline fired, not two, and the one that fired is 42's.
  expect(p.log).toContain('cleared');
  expect(ringtone.ringingFor()).toBeNull();
});
