import { Platform } from 'react-native';

import { loadNotifications } from './expoNotifications';

/**
 * The Android notification channel a job offer rings on (ADR-0046 §2).
 *
 * **This string is half of a pair.** The other half is
 * `TripOfferedNotification::pushOptions()` in the backend, which puts it on
 * the ticket as `channelId`. Nothing at either end can check the two match —
 * a push naming a channel that does not exist is delivered on the default
 * one, silently and at ordinary importance, which is exactly the failure that
 * looks like "push is working, it just never rings". They are written down in
 * both places and asserted in `TripOfferedPushTest`.
 */
export const OFFER_CHANNEL_ID = 'offers.v1';

/**
 * The file name, without its path, exactly as the `expo-notifications` config
 * plugin exposes it after a build. It has to be bundled by that plugin —
 * pointing a channel at a file the build did not include gives silence.
 */
const OFFER_SOUND = 'offer_ring.wav';

/**
 * Creates the channels this app rings on.
 *
 * ## Why the id carries a version, and why that is not fussiness
 *
 * **An Android notification channel is immutable once created.** Past its
 * name and description, the OS refuses every change — deliberately, so an app
 * cannot override choices a user made about how it is allowed to interrupt
 * them. `setNotificationChannelAsync` does not fail when it is called again
 * with a different sound; it succeeds and changes nothing.
 *
 * The consequence is easy to get wrong and painful to diagnose: changing the
 * ringtone in this file and rebuilding does nothing on any handset that has
 * run the app before, only on a fresh install. That is the worst kind of
 * difference between a developer's phone and a driver's.
 *
 * So a change of sound, importance or vibration means **a new id** —
 * `offers.v2` — created alongside, with the old one deleted in the same
 * release. Both ends move together, since the server names the channel.
 *
 * ## Android only
 *
 * iOS has no channels; the sound rides on the message, which is why
 * `pushOptions()` sets `sound` as well as `channelId`. Calling this on iOS is
 * a no-op rather than an error, so callers do not have to branch.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const Notifications = await loadNotifications();

  if (Notifications === null) {
    return;
  }

  try {
    await Notifications.setNotificationChannelAsync(OFFER_CHANNEL_ID, {
      // What a driver sees in Android's own notification settings, where they
      // are entitled to turn this off. Named for the thing rather than for
      // the app, so the row reads as a choice about job offers and not as
      // "KangaruRide, on or off".
      name: 'Job offers',
      description:
        'Rings when a passenger is waiting and you have seconds to answer. Turning this off means you will not hear jobs arrive.',

      // MAX, not HIGH: this is what earns a heads-up banner over the lock
      // screen rather than a line in the shade. Reserved for this one
      // channel — ADR-0025 §5 argues the case, and it is the only message in
      // the platform with a countdown on it.
      importance: Notifications.AndroidImportance.MAX,
      sound: OFFER_SOUND,

      // A ring-like cadence rather than a single buzz, so it is recognisable
      // through a jacket. Milliseconds, alternating wait and vibrate.
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      enableVibrate: true,

      // **Through Do Not Disturb.** A driver who has gone on duty has said
      // they are working; a phone silenced for the night should still ring
      // for the job they signed on for. This is a real intrusion and it is
      // bounded by the duty toggle — go offline and nothing on this channel
      // is sent, because the matcher does not offer to drivers who are off.
      //
      // Android only honours this if the user grants the app DND access;
      // without it the flag is ignored rather than refused, so this degrades
      // rather than breaking.
      bypassDnd: true,

      // The pickup shows on a locked screen, which is a deliberate trade
      // ADR-0025 §5 records making: a driver cannot judge a job without
      // knowing where it starts. The passenger's name and number are never
      // in the payload, so there is nothing here to hide behind a `PRIVATE`.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,

      lightColor: '#01903D',
      showBadge: true,
    });
  } catch {
    // A channel that could not be created costs the ringtone, not the offer.
    // The push still arrives on the default channel, the poll still runs, and
    // the app still works — quietly, which is the whole of ADR-0025 §3.
  }
}
