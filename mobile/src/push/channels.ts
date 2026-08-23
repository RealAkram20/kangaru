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
 * The incoming-call channel: the one the driver actually hears and answers.
 *
 * ## What changed, and why `v1` had to be abandoned rather than edited
 *
 * `offers.call.v1` was **silent by construction**. The design split the job in
 * two — `offers.v2` carried the noise, this carried the picture — so the two
 * could not ring over each other. That split is what the owner reported as
 * *"it won't ring when I am not in the app"*: the notification with the Accept
 * and Decline buttons on it was, by design, incapable of making a sound, and
 * the one that was supposed to ring is named by the **server**, which had not
 * shipped the half that names it. One notification could be heard and not
 * answered; the other could be answered and not heard.
 *
 * So the ring moves here, onto the notification a driver actually interacts
 * with. **A channel is immutable once created** — see `ensureNotificationChannels`
 * — so this could not be edited into `v1`. The id moves, `v1` is deleted below,
 * and every handset that has already run the app gets the new one.
 *
 * ## What a driver gets now, in each of the two states that matter
 *
 * - **Phone in use** — unlocked, on the home screen, in another app. Android
 *   posts a **heads-up**: a banner over whatever they are doing, ringing, with
 *   Decline and Accept on it. That is `AndroidImportance.HIGH` plus a sound,
 *   and it is the whole of what an incoming WhatsApp call looks like on an
 *   unlocked phone. It needs no special permission.
 * - **Screen locked or dark** — the `fullScreenAction` on the notification
 *   asks Android to start the activity instead, and `withLockScreenCallUi`'s
 *   `showWhenLocked` and `turnScreenOn` draw it in front of the keyguard.
 *   That half *does* need `USE_FULL_SCREEN_INTENT` on Android 14 and up, and
 *   degrades silently to the heads-up above without it (`fullScreenIntent.ts`).
 *
 * The important consequence of that pairing: **the heads-up is not a
 * consolation prize.** A driver whose handset refuses the full-screen intent
 * still gets a ringing, answerable notification over whatever they are doing.
 *
 * ## Silent mode and Do Not Disturb are honoured, and that is unchanged
 *
 * `bypassDnd` is false here, exactly as it is on `offers.v2`, and for the
 * owner's own reason: a driver silences a phone on purpose and for reasons the
 * app does not know — a funeral, a clinic, a passenger asleep in the back —
 * and an app that rings through it is one they silence permanently in
 * Android's own settings, where the office cannot see it.
 *
 * `v1` bypassed DND, and it could afford to because it made no sound. This one
 * makes a sound, so it cannot. What is lost is a ring for a driver who is on
 * duty with DND on; what is kept is a driver who does not uninstall the app.
 * The screen still lights (`lightUpScreen`) and the offer still appears.
 *
 * The interruption is bounded by the duty toggle either way. Go offline and
 * the matcher does not offer, so nothing is sent on this channel at all.
 */
export const OFFER_CALL_CHANNEL_ID = 'offers.call.v2';

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
const RETIRED_CHANNEL_IDS = ['offers.v1', 'offers.call.v1'];

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
      // Named for what a driver experiences, not for the mechanism. This is
      // the row they will look for in Android's settings when they want to
      // change the sound or stop being interrupted, so it has to read as the
      // thing itself.
      name: 'Incoming jobs',
      description:
        'Rings and shows the job over whatever you are doing, the way an incoming call does. Turning this off means jobs arrive in silence.',

      // **MAX, not HIGH, and the difference is the whole feature on an
      // unlocked phone.** HIGH earns a heads-up in most states; MAX is what
      // reliably earns one over a full-screen app — a driver watching a video
      // or using maps is exactly who must not miss a job. On a locked screen
      // the `fullScreenAction` takes over instead, so this costs nothing
      // there.
      importance: Notifications.AndroidImportance.MAX,

      // **The ring, moved here from `offers.v2`.** It belongs on the
      // notification the driver can actually answer — see the docblock on the
      // id for why the old split left one notification audible and the other
      // answerable.
      sound: OFFER_SOUND,

      // A ring-like cadence rather than a single buzz, so it is recognisable
      // through a jacket. Milliseconds, alternating wait and vibrate. The same
      // pattern `offers.v2` uses, because they are the same event.
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      enableVibrate: true,

      // **False now, where `v1` was true, and the reason is that this channel
      // can make a noise.** `v1` bypassed Do Not Disturb on the argument that
      // a silent channel cannot wake a household. That argument does not
      // survive the sound moving here, and the owner's rule — silent means
      // silent — is the one that governs. `lightUpScreen` on the notification
      // still lights a dark screen, so a driver on duty with DND on sees the
      // job even though they do not hear it.
      bypassDnd: false,

      // The pickup shows on a locked screen, which is the trade ADR-0025 §5
      // records making: a driver cannot judge a job without knowing where it
      // starts. The payload carries no passenger identity to expose.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,

      lightColor: '#01903D',
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
