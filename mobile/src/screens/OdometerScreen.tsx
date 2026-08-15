import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useSync } from '../offline/SyncProvider';
import { useTrip } from '../trips/queries';
import { Button, Card, Field, Notice, Screen } from '../ui/components';
import { colors, spacing, typography } from '../ui/theme';
import type { TripsStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<TripsStackParams, 'Odometer'>;

/**
 * Odometer capture.
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

  const [reading, setReading] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const opening = to === 'trip_completed' ? trip?.odometer_start ?? null : null;
  const error = validate(reading, opening, trip?.odometer_max_km_per_trip ?? null);
  const isOpening = to === 'trip_started';

  const takePhoto = async () => {
    setCameraProblem(null);

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      setCameraProblem('The camera is not available. You can still record the reading.');

      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      // The server accepts up to 10 MB, but that is an allowance for an
      // unresized phone photo, not a target: this file may sit in a queue for
      // hours and then upload over an upcountry connection. A legible
      // dashboard needs far less.
      allowsEditing: false,
      exif: false,
    });

    if (!result.canceled && result.assets[0] !== undefined) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const submit = async () => {
    if (error !== undefined) {
      return;
    }

    setBusy(true);

    try {
      await queueTransition({
        tripId,
        from,
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

    // The closing reading ends the job, so it does not go back — behind this
    // modal is the live-leg screen for a trip that has just finished, and
    // returning there offers an End trip button that 422s out of the outbox.
    // `replace`, not `navigate`: the odometer form must not sit in the stack
    // behind the completion screen, or the back gesture reopens a reading
    // that has already been queued.
    //
    // The opening reading still goes back, because there the trip carries on
    // and the screen behind it is the right place to land.
    if (to === 'trip_completed') {
      navigation.replace('RideComplete', { tripId });

      return;
    }

    navigation.goBack();
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>
            {isOpening ? 'Opening odometer' : 'Closing odometer'}
          </Text>
          <Text style={styles.subtitle}>
            Read the number off the dashboard, in whole kilometres.
          </Text>

          {saveFailed && (
            <Notice
              tone="danger"
              message="This phone could not save the reading. Do not leave this screen — try again, and write the number down if it keeps failing."
            />
          )}

          {opening !== null && (
            <Notice
              tone="info"
              message={`This trip opened at ${opening.toLocaleString()} km.`}
            />
          )}

          <Card>
            <Field
              label="Kilometres"
              value={reading}
              onChangeText={(text) => setReading(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="104320"
              style={styles.readingInput}
              error={reading === '' ? undefined : error}
              autoFocus
            />
          </Card>

          <Card>
            <Text style={styles.photoTitle}>Dashboard photo</Text>
            <Text style={styles.photoHint}>
              Optional. If the camera will not focus, record the reading anyway — the number is what
              matters.
            </Text>

            {cameraProblem !== null && <Notice message={cameraProblem} />}

            {photoUri !== null && (
              <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
            )}

            <View style={styles.photoActions}>
              <Button
                label={photoUri === null ? 'Take photo' : 'Retake photo'}
                tone="neutral"
                onPress={() => void takePhoto()}
              />
              {photoUri !== null && (
                <Button label="Remove photo" tone="neutral" onPress={() => setPhotoUri(null)} />
              )}
            </View>
          </Card>

          <Button
            label={isOpening ? 'Start trip' : 'Complete trip'}
            busy={busy}
            disabled={reading === '' || error !== undefined}
            onPress={() => void submit()}
          />

          <Text style={styles.footnote}>
            This is saved on the phone first and sent when there is a connection. You can close the
            app.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * The two rules the server will apply, applied here first.
 *
 * `odometer_end` must be **≥ `odometer_start`** and must not put the journey
 * beyond the operator's ceiling, or the server 422s. Both are caught here so
 * the driver hears about it while they are still looking at the dashboard,
 * rather than as a parked queue item an hour later — this screen does not send
 * the transition, it queues it (ADR-0023), so the server's answer is genuinely
 * that far away.
 *
 * **`ceiling` is served on the trip, never hardcoded** (ADR-0035). The office
 * can change it in the console, and a handset holding its own copy would go on
 * enforcing the old number on devices nobody can reach — the exact defect this
 * codebase records under the audit agent's finding 5. It arrives cached with
 * the trip, so it is present in a dead zone too, which is where readings get
 * typed.
 *
 * A trip fetched before the field existed has no ceiling, and that is treated
 * as "no local opinion" rather than as zero: the server still enforces it, and
 * refusing a legitimate reading because the payload is old would be worse than
 * letting the 422 arrive late.
 */
function validate(
  reading: string,
  opening: number | null,
  ceiling: number | null,
): string | undefined {
  if (reading === '') {
    return 'Enter the reading.';
  }

  const value = Number.parseInt(reading, 10);

  if (Number.isNaN(value)) {
    return 'Enter the reading in whole kilometres.';
  }

  if (opening !== null && value < opening) {
    return `This cannot be less than the opening reading of ${opening.toLocaleString()} km.`;
  }

  if (opening !== null && ceiling !== null && value - opening > ceiling) {
    const travelled = value - opening;

    // Names the figure and the limit, like the server's own message: "too
    // long" leaves a driver guessing which digit to change.
    return `That makes this trip ${travelled.toLocaleString()} km, over the ${ceiling.toLocaleString()} km limit for one journey. Check the reading.`;
  }

  return undefined;
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
  readingInput: {
    ...typography.odometer,
    color: colors.text,
    minHeight: 68,
  },
  photoTitle: {
    ...typography.label,
    color: colors.text,
  },
  photoHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  photoActions: {
    gap: spacing.sm,
  },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: spacing.md,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
