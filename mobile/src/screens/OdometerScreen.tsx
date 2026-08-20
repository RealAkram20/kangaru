import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';

import { useSync } from '../offline/SyncProvider';
import { validateOdometerReading } from '../trips/odometer';
import { OdometerCapture } from '../trips/OdometerCapture';
import { useTrip } from '../trips/queries';
import { Button, Notice, Screen, ScreenHeader } from '../ui/components';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, spacing, typography } from '../ui/theme';
import type { TripsStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<TripsStackParams, 'Odometer'>;

/**
 * Odometer capture — the closing reading, and the opening one only for a trip
 * found already at `passenger_onboard`.
 *
 * **The opening reading is ordinarily taken at the kerb now**, on
 * `WaitingForPassengerScreen`, where "Passenger on board" starts the trip in
 * the same press (the owner's ruling: fewer taps). This screen is what
 * `activeTripRoute` still opens for a trip stranded at `passenger_onboard` —
 * a queued boarding whose start never followed — because from that state the
 * reading is the only way out. The capture itself is the shared
 * `OdometerCapture`; the rules below are the same on both screens.
 *
 * PROJECT.md: the opening and closing readings are two of the six data points
 * Centenary Bank accepts this platform on, and "a trip that completes without
 * a reading is a failed delivery of the thing being bought". So:
 *
 * - **The number is required and the photo is not.** That is the server's own
 *   decision (`TransitionTripRequest`: a camera that will not focus in the
 *   dark must not be able to strand a trip) and the screen must not quietly
 *   reimpose a stricter rule.
 * - **Whole kilometres only.** The field stores an integer; a dashboard shows
 *   whole kilometres, and accepting `104320.5` would 422 after the driver has
 *   already put the phone down.
 * - **The closing reading is checked against the opening one here** as well as
 *   on the server. The server's 422 is authoritative, but it arrives minutes
 *   later out of the outbox, by which time the driver has walked away.
 */
export function OdometerScreen({ route, navigation }: Props) {
  const { tripId, to, from } = route.params;
  const { data: trip } = useTrip(tripId);
  const { queueTransition } = useSync();

  const inputRef = useRef<TextInput>(null);

  /**
   * Raise the keypad once the modal has finished arriving.
   *
   * **`autoFocus` was here and it did not work**, which is the whole of the
   * owner's *"in the emulator i can not enter the Odometer"*. Reproduced on a
   * device: navigate here and the screen settles with an empty field, no
   * cursor and no keyboard, above a button disabled until something is typed.
   * Nothing is broken and nothing says so — the driver has to work out that the
   * box needs tapping first. On the one screen standing between them and
   * starting a trip.
   *
   * `autoFocus` requests focus at mount, which on Android is *during* this
   * modal's entry animation; the focus is taken and the keyboard never comes
   * up. Deferring the focus past the animation is the fix, and it has to be a
   * real `focus()` call, which is why `Field` now forwards its ref.
   *
   * **`requestIdleCallback`, not `InteractionManager`.** The first version used
   * `runAfterInteractions` and worked — the caret appeared on the device — but
   * it put a deprecation warning on the driver's screen: React Native has
   * deprecated `InteractionManager` and its own message names this as the
   * replacement. It carries the same meaning here, "once the thread has
   * finished the work the transition queued".
   *
   * Cancelled on unmount so a driver who backs straight out does not leave a
   * focus landing on a screen that has gone.
   */
  useEffect(() => {
    const handle = requestIdleCallback(() => inputRef.current?.focus());

    return () => cancelIdleCallback(handle);
  }, []);

  const [reading, setReading] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const opening = to === 'trip_completed' ? (trip?.odometer_start ?? null) : null;
  const error = validateOdometerReading(reading, opening, trip?.odometer_max_km_per_trip ?? null);
  const isOpening = to === 'trip_started';

  const submit = async () => {
    if (error !== undefined) {
      return;
    }

    setBusy(true);

    try {
      // **Boarding is queued here, not by the button that opened this screen.**
      // `driver_arrived -> trip_started` is not a legal edge (`TripStatus::
      // allowedTransitions`), so `passenger_onboard` has to be posted in
      // between — but posting it on the *previous* press committed it before
      // the reading existed. A driver who then backed out of this modal left
      // the trip stranded at `passenger_onboard`, which `activeTripRoute` routes
      // straight back here: a state with no exit but this form. Queueing both
      // from one submit means nothing is committed until the driver commits.
      //
      // The two land in the same per-trip stream and drain strictly in order
      // (ADR-0023 §5), so the server sees the same sequence it saw before.
      if (from === 'driver_arrived') {
        await queueTransition({ tripId, from, to: 'passenger_onboard' });
      }

      await queueTransition({
        tripId,
        // The opening reading always departs from `passenger_onboard` — either
        // the item queued a line above, or a trip already sitting there because
        // a previous attempt got that far. The graph allows nothing else.
        from: isOpening ? 'passenger_onboard' : from,
        to,
        photoUri,
        ...(isOpening
          ? { odometerStart: Number.parseInt(reading, 10) }
          : { odometerEnd: Number.parseInt(reading, 10) }),
      });
    } catch {
      // The queue could not accept it — the database is not open yet, or the
      // write failed. The one thing that must not happen is navigating away as
      // though it were saved: the reading stays on screen so the driver can
      // try again or write it down.
      setBusy(false);
      setSaveFailed(true);

      return;
    }

    setBusy(false);

    // **Neither reading goes back, and the opening one is the bug this fixes.**
    // It used to `goBack()`, which returned the driver to the waiting screen —
    // a screen that renders "Start Trip" and has no idea the trip has moved.
    // `queueTransition` writes nothing to the cache and `sync()` invalidates
    // only on a completed drain, so in a dead zone (a basement car park, which
    // is what that screen is written for) the driver landed on a view
    // byte-identical to the one they had just left. Pressing the only button on
    // it queued a second `passenger_onboard`, which the server refuses and the
    // outbox parks. Reported by the owner as "hard to start the trip".
    //
    // `replace`, not `navigate`, on both: the form must not sit in the stack
    // behind the screen that follows it, or the back gesture reopens a reading
    // that has already been queued.
    navigation.replace(
      // Trip Started is `TripInProgressScreen`'s status — see the ownership
      // table in `docs/agent-worklog.md`. Landing there is the driver seeing
      // the transition they just made, which is the whole of the fix.
      to === 'trip_completed' ? 'RideComplete' : 'TripInProgress',
      { tripId },
    );
  };

  return (
    <Screen>
      {/*
        The same two pieces of chrome every other screen in this app opens
        with, and this one had neither.

        `SyncBanner` matters more here than almost anywhere: the footnote at the
        bottom promises the reading is "sent when you have signal", and this was
        the one screen making that promise without showing whether there *is*
        signal or how much is waiting.
      */}
      <ScreenHeader
        title={isOpening ? 'Opening odometer' : 'Closing odometer'}
        // The stock header used to sit above this saying "Odometer", so the
        // screen named itself twice in two different type styles. One title.
        subtitle={null}
        onBack={() => navigation.goBack()}
      />

      {/*
        Below the header, which carries the status-bar inset: mounted first,
        the banner's text paints under the clock and the battery — the owner's
        screenshot, and the same bug HomeScreen's own comment records.
      */}
      <SyncBanner />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {saveFailed && (
            <Notice tone="danger" message="Could not save. Try again, and write the number down." />
          )}

          {opening !== null && (
            <Notice tone="info" message={`This trip opened at ${opening.toLocaleString()} km.`} />
          )}

          <OdometerCapture
            reading={reading}
            onChangeReading={setReading}
            error={error}
            photoUri={photoUri}
            onChangePhoto={setPhotoUri}
            inputRef={inputRef}
          />

          <Button
            // **Not "Start trip", which is the button that opened this screen.**
            // Two buttons a press apart carrying the same three words read as
            // one press that did not work — and the second one arrives
            // disabled, which is how the owner met it. This names both halves
            // of what the press actually does. The closing side already differs
            // from its opener ("End trip" -> "Complete trip") and is left alone.
            label={isOpening ? 'Record and start trip' : 'Complete trip'}
            busy={busy}
            disabled={reading === '' || error !== undefined}
            onPress={() => void submit()}
          />

          {/*
            **Kept, at a third of the length.** ADR-0023 queues this reading
            rather than sending it, and a driver who does not know that will sit
            in a dead zone waiting for a confirmation that is not coming, or
            retype a reading already queued. The behaviour is the message; the
            reassurance around it is not.
          */}
          <Text style={styles.footnote}>Saved on this phone, sent when you have signal.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
