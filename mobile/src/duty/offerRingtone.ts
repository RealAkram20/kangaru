import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';

import { Ringtone } from './ringtone';
import { ringtoneEnabled } from './ringtonePreference';

/**
 * The one ringtone in the app, wired to the device (ADR-0046 §3).
 *
 * `ringtone.ts` holds the rules and is tested; this holds the native calls and
 * is not. Everything here is arranged so that the untested half stays too
 * small and too dull to hide a bug.
 *
 * ## Why a module singleton and not `useAudioPlayer`
 *
 * `OfferPresenter` remounts `OfferScreen` on `key={offer.id}` — deliberately,
 * so a second job re-seeds its own countdown rather than inheriting the first
 * one's elapsed seconds. A hook-owned player would therefore be **a new player
 * per offer**, and the stop that ran on cleanup would be stopping an object
 * the sound was no longer coming from.
 *
 * Expo SDK 57 makes that failure permanent rather than transient: a looping
 * player is currently kept alive by a strong native reference after its owner
 * unmounts (expo/expo#47569). One player, created once, is what makes `halt()`
 * mean something.
 */

/**
 * A ring-like cadence, matching the notification channel's vibration so the
 * handset feels the same whether the app is open or the offer arrived on a
 * locked screen. Milliseconds, alternating wait and buzz.
 */
const PATTERN = [0, 500, 250, 500, 250, 500];

let player: AudioPlayer | null = null;
let audioModeSet = false;

/**
 * Built on first use, not at import.
 *
 * Constructing an audio player reaches a native module, and this file is
 * imported by the navigator — doing it at module scope would put a native call
 * on the app's launch path for a sound that most launches never play.
 */
function ensurePlayer(): AudioPlayer | null {
  if (player !== null) {
    return player;
  }

  try {
    player = createAudioPlayer(require('../../assets/sounds/offer_ring.wav'));
    player.loop = true;

    return player;
  } catch {
    // No audio on this device, or the asset did not make it into the build.
    // The offer still arrives, the screen still counts down, and the handset
    // still vibrates — ADR-0025 §3's rule applied one level down: the ring
    // shortens the driver's reaction time and is not the mechanism.
    return null;
  }
}

/**
 * The session settings a ringtone needs, applied once.
 *
 * **`duckOthers`, not `doNotMix`.** A driver being offered a job is very often
 * mid-turn-instruction in Google Maps, and taking exclusive audio focus would
 * cut that instruction off entirely. Lowering it for four seconds is the
 * lesser harm — and a missed turn caused by our ringtone would be a road
 * safety problem, not a UX one.
 *
 * **`playsInSilentMode`.** An offer must ring on a handset the driver has
 * silenced, for the same reason the notification channel bypasses Do Not
 * Disturb: going on duty is a statement that they are working. The driver's
 * own switch — `ringtonePreference` — is the smaller, honest way to opt out.
 */
function ensureAudioMode(): void {
  if (audioModeSet) {
    return;
  }

  audioModeSet = true;

  void setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    // The offer can arrive while the app is backgrounded and the ring has to
    // survive being brought forward, which on Android means the session must
    // not be torn down on the transition.
    shouldPlayInBackground: true,
  }).catch(() => {
    // Defaults will have to do. Worst case the ring is quieter than intended
    // or does not pierce silent mode; the notification and the vibration are
    // both still there.
  });
}

export const offerRingtone = new Ringtone({
  play: () => {
    if (!ringtoneEnabled()) {
      return;
    }

    ensureAudioMode();

    const active = ensurePlayer();

    if (active === null) {
      return;
    }

    try {
      // From the top every time. Without the seek, a ring stopped part-way
      // through resumes from wherever it was silenced — so the second job of
      // a shift starts on the tail of the first chime and sounds like a
      // glitch rather than a call.
      void active.seekTo(0);
      active.play();
    } catch {
      // A player disposed underneath us. Dropped rather than rebuilt: a retry
      // loop around audio is how a phone ends up making noise nobody asked
      // for, which is the exact failure this whole module is shaped to avoid.
    }
  },

  halt: () => {
    // **Never guarded on the preference.** A driver who switches the ringtone
    // off mid-ring must be able to silence what is already playing, and a
    // `halt` that checked `ringtoneEnabled()` would refuse to stop the one
    // sound they were trying to stop.
    if (player === null) {
      return;
    }

    try {
      player.pause();
      void player.seekTo(0);
    } catch {
      // Already gone. Silence achieved by other means.
    }
  },

  buzz: () => {
    if (!ringtoneEnabled()) {
      return;
    }

    // `true` repeats the pattern. It is what makes this findable in a pocket,
    // and it is also why every path out of this module has to call
    // `stillness` — a repeating vibration outlives the app that started it.
    Vibration.vibrate(PATTERN, true);
  },

  // Unguarded, for the same reason as `halt`, and cheap enough to call
  // whenever anything ends.
  stillness: () => Vibration.cancel(),

  setTimer: (callback, ms) => setTimeout(callback, ms) as unknown as number,
  clearTimer: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
});
