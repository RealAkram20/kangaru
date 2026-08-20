import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { offerRingtone } from '../duty/offerRingtone';
import { openTrip } from '../navigation/navigationRef';
import { loadNotifications } from './expoNotifications';
import { intentFrom, type PushIntent } from './routing';

/**
 * Acts on a notification (ADR-0046 §4).
 *
 * ## What was missing before this
 *
 * Everything. The app registered a push token and then had no
 * `setNotificationHandler`, no response listener and no cold-start check — so
 * a job offer arriving while the app was open was **silently swallowed by the
 * OS**, and a tap on one from the shade opened the app on whatever screen it
 * happened to be showing. The offer was then found, or not, by the
 * five-second poll. The push shortened nothing.
 *
 * ## The three arrivals, which are three different problems
 *
 * 1. **App open.** Android suppresses a notification whose app is in the
 *    foreground unless a handler says otherwise. Without one the driver gets
 *    no banner and no ring while staring at the app — the state they are in
 *    most of a shift.
 * 2. **App backgrounded, then tapped.** `addNotificationResponseReceivedListener`
 *    fires. Ordinary, and the case everyone implements.
 * 3. **App killed, launched by the tap.** No listener exists yet when the tap
 *    happens — the process is being created *because* of it.
 *    `getLastNotificationResponseAsync` is the only way to see it, and it must
 *    be asked once at start-up. This is the case that matters most on cheap
 *    Android hardware, where the process is trimmed constantly, and it is the
 *    one that silently does nothing if forgotten.
 *
 * ## Why it invalidates rather than navigates
 *
 * An offer is painted by `OfferPresenter`, an overlay outside the navigator,
 * from `useOffers`. So the honest response to "a job is waiting" is to make
 * that query refetch: the overlay then appears over whatever the driver was
 * doing, with the server's own current answer.
 *
 * Navigating instead would fight the overlay, and worse, would trust the push
 * — a payload from before an update, or one describing an offer another driver
 * has since taken. Refetching asks the platform rather than the notification,
 * which is ADR-0025 §3 applied to routing: push shortens the latency and is
 * never the source of truth.
 */
export function PushRouter() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Signed out, there is nothing to open and nothing this driver owns. A
    // handset that acted on a push while signed out would be acting on the
    // *previous* driver's job (ADR-0025 §4).
    if (user === null) {
      return;
    }

    let cancelled = false;

    const act = (intent: PushIntent) => {
      if (cancelled) {
        return;
      }

      switch (intent.kind) {
        case 'open_offer':
          // Ask the platform, do not believe the payload. `OfferPresenter`
          // paints whatever comes back — including nothing, if the job was
          // taken while the phone was ringing, which is the correct outcome.
          void queryClient.invalidateQueries({ queryKey: ['offers'] });
          break;

        case 'withdraw_offer':
          // Silence first: the driver is holding a phone that is ringing for
          // a job that no longer exists, and every further second of it is
          // the app wasting their attention. The refetch then removes the
          // overlay, but it crosses a network and the ring should not wait
          // for it.
          offerRingtone.stopFor(intent.offerId);
          void dismissOffer(intent.offerId);
          void queryClient.invalidateQueries({ queryKey: ['offers'] });
          break;

        case 'open_trip':
          void queryClient.invalidateQueries({ queryKey: ['trips'] });
          openTrip(intent.tripId);
          break;

        case 'ignore':
          break;
      }
    };

    /** Clears the notification for an offer that is over, if one is showing. */
    const dismissOffer = async (offerId: number) => {
      const Notifications = await loadNotifications();

      // Presented notifications carry the same `data` the push arrived with,
      // so the one to clear is found by the offer it names rather than by an
      // identifier we would otherwise have to store across a process death.
      const showing = (await Notifications?.getPresentedNotificationsAsync()) ?? [];

      await Promise.all(
        showing
          .filter(
            (item) => intentFrom(item.request.content.data).kind !== 'ignore' &&
              (item.request.content.data as { offer_id?: unknown }).offer_id?.toString() ===
                offerId.toString(),
          )
          .map((item) => Notifications?.dismissNotificationAsync(item.request.identifier)),
      );
    };

    const subscribe = async () => {
      const Notifications = await loadNotifications();

      if (Notifications === null || cancelled) {
        return;
      }

      // (1) Arrival while the app is open. Without this Android decides, and
      // it decides to suppress.
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          // **Both false, deliberately, and this is not a downgrade.**
          //
          // The app is on screen, so `OfferPresenter` is already painting the
          // offer and `offerRingtone` is already ringing it — from the app's
          // own player, which loops for the whole countdown. Letting the OS
          // play the channel sound as well would layer a second, unsynchronised
          // ring over the first, and neither would stop when the other did.
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });

      // (3) Launched by a tap on a notification, from a killed process. Asked
      // once, at start-up, because no listener can have been present for it.
      const launch = await Notifications.getLastNotificationResponseAsync();

      if (launch !== null) {
        act(intentFrom(launch.notification.request.content.data));
      }

      // (2) Tapped while the app was alive.
      const tapped = Notifications.addNotificationResponseReceivedListener((response) =>
        act(intentFrom(response.notification.request.content.data)),
      );

      // A withdrawal is a data push that arrives without being tapped — the
      // point of it is to stop a ring nobody is looking at. So it is handled
      // on *receipt*, not on response.
      const received = Notifications.addNotificationReceivedListener((notification) => {
        const intent = intentFrom(notification.request.content.data);

        if (intent.kind === 'withdraw_offer') {
          act(intent);
        }
      });

      return () => {
        tapped.remove();
        received.remove();
      };
    };

    const pending = subscribe();

    return () => {
      cancelled = true;
      void pending.then((unsubscribe) => unsubscribe?.());
    };
  }, [user, queryClient]);

  return null;
}
