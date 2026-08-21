import { Platform } from 'react-native';

import { loadNotifications } from './expoNotifications';

/**
 * The Android notification channel a job offer rings on (ADR-0046 §2,
 * amended by ADR-0049 §4).
 *
 * **This string is half of a pair.** The other half is
 * `TripOfferedNotification::pushOptions()` in the backend, which puts it on
 * the ticket as `channelId`. Nothing at either end can check the two match —
 * a push naming a channel that does not exist is delivered on the default
 * one, silently and at ordinary importance, which is exactly the failure that
 * looks like "push is working, it just never rings". They are written down in
 * both places and asserted in `TripOfferedPushTest`.
 *
 * **`v2` since ADR-0049.** `offers.v1` bypassed Do Not Disturb and rang
 * through a silenced handset. The owner asked for the opposite — a ring
 * unless the phone is on silent or in DND — and a channel cannot be edited to
 * do that (see `ensureNotificationChannels`), so the id moved and `v1` is
 * deleted below.
 */
export const OFFER_CHANNEL_ID = 'offers.v2';

/**
 * The channel that carries the full-screen call UI, and nothing else
 * (ADR-0049 §4).
 *
 * ## Why the popup is on its own channel rather than on `offers.v2`
 *
 * Because the two want opposite settings, and one channel cannot hold both.
 *
 * `offers.v2` is the **noise**: it is what a driver hears, and the owner's
 * rule is that it must fall silent under silent mode and Do Not Disturb.
 * This one is the **picture**: the notification whose only job is to hold a
 * `fullScreenAction` so Android launches the app over the lock screen. It
 * carries no sound and no vibration at all, which is what makes the next
 * paragraph defensible.
 *
 * ## Why this one *does* bypass Do Not Disturb, when the ring does not
 *
 * A channel that cannot make a sound cannot wake a sleeping household, so the
 * usual argument against bypassing DND does not apply to it. What it can do
 * is show a driver the job they turned their phone to Do Not Disturb *while
 * on duty* to receive — and if this respected DND, the whole feature would
 * silently not exist for every driver who drives with DND on, which is a good
 * share of them. That is the failure this codebase keeps finding and keeps
 * writing down: not a crash, but a capability that quietly is not there.
 *
 * The interruption is bounded by the duty toggle. Go offline and the matcher
 * does not offer, so nothing is sent on this channel at all.
 */
export const OFFER_CALL_CHANNEL_ID = 'offers.call.v1';

/**
 * The file name, without its path, exactly as the `expo-notifications` config
 * plugin exposes it after a build. It has to be bundled by that plugin —
 * pointing a channel at a file the build did not include gives silence.
 */
const OFFER_SOUND = 'offer_ring.wav';

/**
 * Channels this app has used and no longer does.
 *
 * Deleted rather than left in place, because every one of them is a row in
 * the driver's own Android notification settings. Left behind, `offers.v1`
 * would sit under "Job offers" beside `offers.v2` with the same name and no
 * way to tell which is live — and a driver who switches the wrong one off has
 * silenced nothing, then reports that the app ignores their setting.
 */
const RETIRED_CHANNEL_IDS = ['offers.v1'];

/**
 * Creates the channels this app rings on and shows call screens from.
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
 * `offers.v3` — created alongside, with the old one added to
 * `RETIRED_CHANNEL_IDS` in the same release. Both ends move together, since
 * the server names the channel.
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

      // **Silent and Do Not Disturb are honoured, and that is a reversal.**
      //
      // `offers.v1` set this true, on the argument that a driver who has gone
      // on duty has said they are working and a phone silenced for the night
      // should still ring for the job they signed on for. The owner's answer
      // is that a driver silences a phone on purpose and for reasons the app
      // does not know — a funeral, a clinic, a passenger asleep in the back —
      // and an app that rings through it is one a driver silences permanently,
      // in Android's own settings, where the office cannot see it.
      //
      // What is *not* lost by this: the screen still lights and the offer
      // still appears, because `OFFER_CALL_CHANNEL_ID` carries the picture and
      // it makes no noise to suppress. Silent means silent, not invisible.
      bypassDnd: false,

      // The pickup shows on a locked screen, which is a deliberate trade
      // ADR-0025 §5 records making: a driver cannot judge a job without
      // knowing where it starts. The passenger's name and number are never
      // in the payload, so there is nothing here to hide behind a `PRIVATE`.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,

      lightColor: '#01903D',
      showBadge: true,
    });

    await Notifications.setNotificationChannelAsync(OFFER_CALL_CHANNEL_ID, {
      name: 'Job offer screen',
      description:
        'Opens the job over your lock screen, the way an incoming call does. It never makes a sound — "Job offers" is what you hear.',

      // HIGH rather than MAX, and it costs nothing. A full-screen intent is
      // what puts this on screen; the heads-up banner MAX would additionally
      // buy is redundant next to the app itself opening, and would show a
      // second offer row behind the one the driver is already answering.
      importance: Notifications.AndroidImportance.HIGH,

      // **Both deliberately off.** See the docblock on the id: the ring lives
      // on `offers.v2` so a driver's silent switch reaches it, and this
      // channel making its own noise would put the sound somewhere that switch
      // cannot reach — the precise thing the owner asked us to stop doing.
      //
      // `null`, not `undefined`: the two are different instructions to
      // Android. Null means *this channel has no sound*; an absent key means
      // *no preference*, and the OS fills that with the default notification
      // tone — a second, wrong ring layered under `offers.v2`'s. There is no
      // `vibrationPattern` for the same reason, with `enableVibrate` false
      // carrying the intent.
      sound: null,
      enableVibrate: false,

      // Silent, therefore allowed through. Argued at the id.
      bypassDnd: true,

      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    });

    // Last, and after the new ones exist. A driver who opens their settings
    // between the delete and the create would otherwise find no job-offer
    // channel at all and reasonably conclude the app has none.
    await Promise.all(
      RETIRED_CHANNEL_IDS.map((id) =>
        Notifications.deleteNotificationChannelAsync(id).catch(() => undefined),
      ),
    );
  } catch {
    // A channel that could not be created costs the ringtone, not the offer.
    // The push still arrives on the default channel, the poll still runs, and
    // the app still works — quietly, which is the whole of ADR-0025 §3.
  }
}
