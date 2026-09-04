import * as ImagePicker from 'expo-image-picker';
import { useState, type RefObject } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, Field, Notice } from '../ui/components';
import { colors, spacing, typography } from '../ui/theme';
import { digitsOnly } from './odometer';

/**
 * An odometer reading and its optional dashboard photograph — the capture,
 * without the screen around it.
 *
 * **Extracted from `OdometerScreen` when the opening reading moved to the
 * kerb.** The owner's ruling: fewer taps, and *"when we onboard the client it
 * automatically starts the trip"*. So the opening reading is now taken on
 * `WaitingForPassengerScreen` while the driver waits, and the one press that
 * follows — "Passenger on board" — starts the trip. `OdometerScreen` keeps the
 * closing reading, and the opening one for a trip found stranded at
 * `passenger_onboard`. Two screens, one capture; AGENTS.md says that becomes
 * shared rather than copied, and the half a copy would have dropped is the
 * camera-refused path.
 *
 * PROJECT.md: the opening and closing readings are two of the six data points
 * Centenary Bank accepts this platform on, so:
 *
 * - **The number is required and the photo is not.** That is the server's own
 *   decision (`TransitionTripRequest`: a camera that will not focus in the
 *   dark must not be able to strand a trip) and no screen may quietly
 *   reimpose a stricter rule.
 * - **Whole kilometres only.** The field holds digits; a dashboard shows whole
 *   kilometres, and accepting `104320.5` would 422 after the driver has already
 *   put the phone down.
 *
 * The parent owns the value and the photo — it is the parent that queues them
 * — and this component owns only the camera, which is the part with a
 * permission prompt and a failure mode.
 *
 * **No placeholder in the field, and that is a rule rather than a
 * simplification.** It was `104320`, drawn in the same 34pt display face as a
 * real reading and separated from one only by being grey. On a handset it read
 * as a number already entered above a disabled button — a driver's reasonable
 * conclusion was that the app was broken. The guidance is a `hint` on the
 * field, beside the control it governs.
 */
export function OdometerCapture({
  reading,
  onChangeReading,
  error,
  photoUri,
  onChangePhoto,
  inputRef,
  label = 'Kilometres',
  hint = 'From the dashboard, in whole kilometres.',
}: {
  reading: string;
  onChangeReading: (reading: string) => void;
  /** The validation message for a non-empty reading; empty is not an error yet. */
  error: string | undefined;
  photoUri: string | null;
  onChangePhoto: (uri: string | null) => void;
  inputRef?: RefObject<TextInput | null>;
  label?: string;
  hint?: string;
}) {
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);

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
      onChangePhoto(result.assets[0].uri);
    }
  };

  return (
    <>
      <Card>
        <Field
          label={label}
          hint={hint}
          value={reading}
          onChangeText={(text) => onChangeReading(digitsOnly(text))}
          keyboardType="number-pad"
          style={styles.readingInput}
          error={reading === '' ? undefined : error}
          ref={inputRef}
        />
      </Card>

      <Card>
        <Text style={styles.photoTitle}>Dashboard photo</Text>
        <Text style={styles.photoHint}>Optional — the number is what matters.</Text>

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
            <Button label="Remove photo" tone="neutral" onPress={() => onChangePhoto(null)} />
          )}
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
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
});
