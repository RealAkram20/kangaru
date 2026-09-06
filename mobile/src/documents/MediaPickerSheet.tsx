import * as ImagePicker from 'expo-image-picker';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { CameraIcon, ImageIcon, XIcon } from '../ui/icons';
import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';

/**
 * How a document gets onto the phone: the camera, or a picture already on it.
 *
 * ## Why this is ours rather than a dependency
 *
 * The obvious build is `expo-document-picker`, which would also accept a PDF.
 * It was refused, by the owner, on `quality-control`'s rule that a new
 * dependency is a decision to be asked about rather than made: this is a
 * second native module and a second dev-build rebuild to add one file type,
 * and the sheet the OS then shows is somebody else's chrome in the middle of
 * our flow. `expo-image-picker` is already a dependency and already does both
 * halves of what a driver actually does.
 *
 * **The cost is real and is stated rather than hidden**: the server accepts
 * PDF (ADR-0033 §5) and this app cannot send one. A driver whose insurance
 * certificate arrived as a PDF by email photographs it, or sends it from the
 * office. That gap is one `expo install` away if it ever bites.
 *
 * ## Two choices, not three
 *
 * There is no "browse files" row, because there is nothing behind it. A
 * disabled third option, or one that opens a picker showing no documents,
 * teaches a driver that the app is broken rather than that the feature is
 * absent.
 *
 * ## Permissions are asked for at the moment they are used
 *
 * Not on mount, and not on opening the sheet. A permission dialog that appears
 * before the driver has said what they want to do is the one people deny out
 * of reflex — and on Android a denied camera permission is awkward to reverse
 * from inside the app. Tapping *Take a photo* is the clearest possible
 * statement of intent, and it is the moment the OS is asked.
 *
 * A refusal returns a **reason**, not a silent close. `null` from the picker
 * means the driver changed their mind, which is not an error and must not
 * render as one.
 */
export type PickedMedia = { uri: string };

export type PickOutcome =
  | { kind: 'picked'; media: PickedMedia }
  | { kind: 'cancelled' }
  | { kind: 'refused'; reason: string };

/**
 * Quality 0.6, and it is not a guess.
 *
 * `StoreDriverDocumentRequest` takes 8 MB, which is an allowance for an
 * unresized phone photo rather than a target: this goes up over a Ugandan
 * mobile connection with somebody watching the progress, and a document that
 * a person in an office has to *read* needs far less than a full-resolution
 * sensor dump. The number is the one `DocumentsScreen` has always used; it is
 * here now so both callers cannot drift.
 */
const QUALITY = 0.6;

export async function captureFromCamera(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();

  if (!permission.granted) {
    return {
      kind: 'refused',
      reason: 'Camera not available. Allow it in your phone settings.',
    };
  }

  const result = await ImagePicker.launchCameraAsync({
    quality: QUALITY,
    allowsEditing: false,
    // Stripped deliberately. A phone photograph carries the GPS coordinates it
    // was taken at, and a national ID photographed at home would put somebody's
    // home address into the operator's document store — personal data nobody
    // asked for, in a place `docs/data-inventory.md` does not list it.
    exif: false,
  });

  if (result.canceled || result.assets[0] === undefined) {
    return { kind: 'cancelled' };
  }

  return { kind: 'picked', media: { uri: result.assets[0].uri } };
}

export async function pickFromLibrary(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    return {
      kind: 'refused',
      reason: 'Photos not available. Allow access in your phone settings.',
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    quality: QUALITY,
    allowsEditing: false,
    exif: false,
    mediaTypes: ['images'],
  });

  if (result.canceled || result.assets[0] === undefined) {
    return { kind: 'cancelled' };
  }

  return { kind: 'picked', media: { uri: result.assets[0].uri } };
}

/**
 * The sheet itself.
 *
 * Named by the document it is about — "National ID" — rather than by the verb.
 * A driver who opened the wrong row finds out here, before they photograph
 * anything, and the sheet is the last cheap place to notice.
 */
export function MediaPickerSheet({
  title,
  note = null,
  onPicked,
  onClose,
  onRefused,
}: {
  /** The document type's label, from the server. */
  title: string;
  /**
   * One line under the title, for a consequence worth knowing *before* the
   * camera opens.
   *
   * It exists for one sentence: replacing a verified document resets the
   * review (ADR-0033 §2). That warning used to sit permanently under the
   * verified row, where it was a standing caution about an action nobody was
   * taking. Here it appears at the only moment it can change a decision — the
   * driver has said "replace this" and has not yet taken the photograph.
   */
  note?: string | null;
  onPicked: (media: PickedMedia) => void;
  onClose: () => void;
  onRefused: (reason: string) => void;
}) {
  const run = async (pick: () => Promise<PickOutcome>) => {
    const outcome = await pick();

    // Closed first, whatever happened. Leaving the sheet up behind a camera
    // that has already returned makes the app look stuck, and a refusal has to
    // be readable on the screen underneath rather than under a scrim.
    onClose();

    if (outcome.kind === 'picked') {
      onPicked(outcome.media);
    } else if (outcome.kind === 'refused') {
      onRefused(outcome.reason);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/*
        The scrim is a control, not decoration: tapping outside a sheet to
        dismiss it is the platform behaviour on both OSes, and a sheet that
        only closes by its own button is one a driver fights.
      */}
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
      >
        {/* Stops a tap on the sheet itself from reaching the scrim behind it. */}
        <Pressable style={styles.sheet} onPress={() => {}} accessible={false}>
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
              {title}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={12}
              style={styles.close}
            >
              <XIcon color={colors.textMuted} size={22} />
            </Pressable>
          </View>

          {note !== null && <Text style={styles.note}>{note}</Text>}

          <Choice
            label="Take a photo"
            hint="Use the camera now"
            icon={<CameraIcon color={colors.primaryText} size={22} strokeWidth={2} />}
            onPress={() => void run(captureFromCamera)}
          />

          <Choice
            label="Choose from your photos"
            hint="Pick a picture you already have"
            icon={<ImageIcon color={colors.primaryText} size={22} strokeWidth={2} />}
            onPress={() => void run(pickFromLibrary)}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Choice({
  label,
  hint,
  icon,
  onPress,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      // One composed sentence rather than two fragments a screen reader reads
      // as unrelated lines (`docs/screen-rules.md` §6).
      accessibilityLabel={`${label}. ${hint}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
    >
      <View style={styles.choiceIcon}>{icon}</View>

      <View style={styles.choiceText}>
        <Text style={styles.choiceLabel}>{label}</Text>
        <Text style={styles.choiceHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  note: {
    ...typography.caption,
    color: colors.warning,
    marginBottom: spacing.xs,
  },
  close: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    flexShrink: 0,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_HEIGHT + 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choicePressed: {
    backgroundColor: colors.surfaceSunken,
  },
  choiceIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
  },
  choiceText: {
    flexShrink: 1,
    gap: 2,
  },
  choiceLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  choiceHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
