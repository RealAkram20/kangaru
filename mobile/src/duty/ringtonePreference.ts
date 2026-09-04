import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'kangaruride.driver.ringtone';

/**
 * Whether a job offer is allowed to make a noise.
 *
 * ## Why this exists rather than "turn off notifications"
 *
 * Because the operating system's own switch is the wrong granularity, and a
 * driver forced to use it loses more than they meant to. `offers.v1` is a MAX
 * importance channel that bypasses Do Not Disturb; a driver in a quiet office,
 * or waiting somewhere they cannot have a phone ring, has exactly two options
 * without this: put up with it, or switch the channel off in Android settings
 * and stop being told about jobs at all. The second is the one they will pick,
 * and it is silent, permanent and invisible to us.
 *
 * So the app offers the smaller answer: keep the notification, drop the sound.
 * The screen still lights, the banner still appears, the countdown still runs.
 *
 * ## Why it is held in memory as well as on disk
 *
 * `Ringtone`'s ports are synchronous, deliberately — they are called from a
 * render path where an `await` would let the first second of a job offer pass
 * in silence. So the stored value is loaded once at start-up into a module
 * variable and read from there.
 *
 * The default while that read is outstanding is **on**. A driver who chose
 * silence and hears one ring during app start-up has been mildly annoyed; a
 * driver who chose sound and misses a job because the preference had not
 * loaded yet has lost a fare.
 */
let enabled = true;

export function ringtoneEnabled(): boolean {
  return enabled;
}

/** Loaded once, at start-up, by the authenticated shell. */
export async function loadRingtonePreference(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEY);

    // Only an explicit "off" turns it off. An absent key, a corrupt value or
    // anything written by a different version of this app all mean on, which
    // is the side that costs a driver nothing.
    enabled = stored !== 'off';
  } catch {
    enabled = true;
  }
}

export async function setRingtoneEnabled(next: boolean): Promise<void> {
  // The in-memory value first, so the very next offer honours the switch the
  // driver just flipped even if the write is slow or fails outright.
  enabled = next;

  try {
    await AsyncStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Losing the write costs the preference at next launch, not now.
  }
}
