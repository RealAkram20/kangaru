import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DriverDocumentSlot, DriverDocumentType } from '../api/endpoints';
import type { ProfileStackParams } from '../navigation/types';
import { useDriverDocuments, useUploadDocument } from '../profile/queries';
import {
  documentAction,
  documentAnnouncement,
  documentNote,
  documentState,
  documentsSummary,
  isoDate,
  warnsAboutReplacing,
} from '../profile/presentation';
import { Notice, Screen, ScreenHeader } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, FileTextIcon, UploadIcon } from '../ui/icons';
import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Documents'>;

/**
 * A photograph waiting for the one thing the server will not accept it
 * without.
 *
 * Held in the screen rather than uploaded immediately, because a driving
 * licence and an insurance certificate are refused without an expiry date
 * (ADR-0033 §3) — and finding that out *after* the upload, as a validation
 * error on a photo already taken, is the worst order to learn it in.
 */
type Staged = {
  type: DriverDocumentType;
  uri: string;
};

/**
 * The driver's papers (ADR-0033).
 *
 * The screen behind the profile's **Documents** row, and the reason that row
 * can say "Verified" at all: before this feature no document existed at any
 * layer, and the word would have been invented.
 *
 * ## Every type is listed, including the ones never sent
 *
 * A driver opening this screen is asking *what do I still owe you*. A list of
 * what they have already uploaded answers a different question, so the server
 * returns all four types with a null document against the missing ones, and
 * this screen draws those as empty slots.
 *
 * ## What each row reads
 *
 * `compliance_state`, never `status`. A verified licence that lapsed last
 * month still carries `status: 'verified'` because nothing wrote to the row,
 * and rendering that would tell a driver their expired licence is fine — the
 * single most dangerous thing this screen could say.
 *
 * ## Uploading is online-only, and says so
 *
 * Every other mutation this app makes goes through the offline outbox
 * (ADR-0023). This one does not: that queue carries small JSON transitions,
 * and an eight-megabyte photograph sitting in it invisibly for hours is worse
 * than a refusal the driver can see and retry.
 *
 * ## The expiry is asked for, never defaulted
 *
 * Two of the four types are meaningless without a date. The screen asks for it
 * **after the photo and before the upload**, driven by the server's own
 * `requires_expiry` flag — not by a copy of the rule in this bundle, which is
 * how a handset ends up asserting a rule the office has since changed.
 */
export function DocumentsScreen({ navigation }: Props) {
  const { data, isLoading, isError, refetch } = useDriverDocuments();
  const upload = useUploadDocument();

  const [busyType, setBusyType] = useState<DriverDocumentType | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const slots = data?.slots ?? [];
  const summary = documentsSummary(data?.compliance);

  const send = async (type: DriverDocumentType, uri: string, expiresAt: string | null) => {
    setBusyType(type);
    setProblem(null);

    try {
      await upload.mutateAsync({ type, uri, expiresAt });
    } catch {
      // "Not queued" is the load-bearing half: every other mutation in this app
      // survives a dead zone (ADR-0023) and this one does not.
      setProblem('Not sent — documents need a connection. They are not queued.');
    } finally {
      setBusyType(null);
    }
  };

  const capture = async (slot: DriverDocumentSlot) => {
    setProblem(null);

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      setProblem('Camera not available. Allow it in your phone settings.');

      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      // The server takes 8 MB. That is an allowance for an unresized phone
      // photo, not a target: this goes up over a Ugandan mobile connection
      // with somebody watching it, and a legible document needs far less.
      quality: 0.6,
      allowsEditing: false,
      exif: false,
    });

    if (result.canceled || result.assets[0] === undefined) {
      return;
    }

    const uri = result.assets[0].uri;

    if (slot.requires_expiry) {
      setStaged({ type: slot.type, uri });

      return;
    }

    await send(slot.type, uri, null);
  };

  return (
    <Screen>
      <ScreenHeader title="Documents" subtitle={summary.label} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {problem !== null && <Notice message={problem} tone="danger" />}

        {isLoading && slots.length === 0 ? (
          <SkeletonCards count={4} />
        ) : slots.length === 0 ? (
          /*
            **Never an empty screen.** Without this, a refused fetch left the
            footnote alone on the page, which reads as "you have no documents"
            — the opposite of the truth, on the screen whose whole subject is
            what the office is holding. Found by walking the failure path.
          */
          <View style={styles.blank}>
            <Text style={styles.blankText}>
              {isError
                ? 'Could not load your documents. This needs a connection.'
                : 'Nothing to show yet.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={() => void refetch()}
              style={styles.retry}
            >
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          slots.map((slot) => (
            <DocumentCard
              key={slot.type}
              slot={slot}
              busy={busyType === slot.type}
              onSend={() => void capture(slot)}
            />
          ))
        )}

        {/*
          The footnote that stood here — "The office checks each one by hand…
          Your work is not blocked while one waits" — said in twenty-one words
          what each card's own status chip says by existing.
        */}
      </ScrollView>

      {staged !== null && (
        <DateTimePicker
          // The picker is a native module with no text and no accessible name
          // of its own, so there is nothing else a test can find it by — the
          // same reason and the same convention `TransactionsScreen` uses.
          testID="expiry-picker"
          value={new Date()}
          mode="date"
          // A document cannot expire in the past and still be worth sending;
          // the server refuses it, and a control that can simply not ask the
          // question is better than a validation error.
          minimumDate={new Date()}
          /*
            `onValueChange` + `onDismiss`, not `onChange`. The old single
            handler is deprecated in datetimepicker 9 and warns on every open —
            reported from a real handset — and the split is genuinely better
            here rather than merely quieter: cancelling on Android fired
            `onChange` with `dismissed` *and the value unchanged*, so every
            call site had to know that trap and hand-check `event.type`. That
            check was the bug this screen most needed to get right, because
            getting it wrong uploads a document against a date the driver
            rejected. Now the library decides which of the two happened.
          */
          onValueChange={(_event, selected) => {
            const pending = staged;

            // Dropped with the date. Retaking a photo is cheap; holding it
            // would leave the card in a state the driver did not ask for.
            setStaged(null);

            if (pending === null) {
              return;
            }

            void send(pending.type, pending.uri, isoDate(selected));
          }}
          onDismiss={() => setStaged(null)}
        />
      )}
    </Screen>
  );
}

function DocumentCard({
  slot,
  busy,
  onSend,
}: {
  slot: DriverDocumentSlot;
  busy: boolean;
  onSend: () => void;
}) {
  const state = documentState(slot);

  // Paired with the word beside it, never standing alone: DESIGN.md § Icons,
  // and `docs/screen-rules.md` §6 on colour never carrying meaning by itself.
  const glyph =
    state.state === 'verified' ? (
      <CheckCircleIcon color={colors.primaryText} size={18} strokeWidth={2} />
    ) : state.state === 'pending' ? (
      <ClockIcon color={colors.warning} size={18} strokeWidth={2} />
    ) : state.state === 'missing' ? (
      <FileTextIcon color={colors.textMuted} size={18} strokeWidth={2} />
    ) : (
      <AlertTriangleIcon color={colors.danger} size={18} strokeWidth={2} />
    );

  const tint =
    state.tone === 'good'
      ? colors.primaryText
      : state.tone === 'danger'
        ? colors.danger
        : state.tone === 'warning'
          ? colors.warning
          : colors.textMuted;

  return (
    <View style={styles.card} accessible accessibilityLabel={documentAnnouncement(slot)}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {slot.type_label}
        </Text>

        <View style={styles.badge}>
          {glyph}
          <Text style={[styles.badgeLabel, { color: tint }]} numberOfLines={1}>
            {state.label}
          </Text>
        </View>
      </View>

      <Text style={styles.cardNote}>{documentNote(slot)}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          `${documentAction(slot)}: ${slot.type_label.toLowerCase()}`
        }
        accessibilityHint={
          slot.requires_expiry ? 'You will be asked when it expires.' : undefined
        }
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onSend}
        style={[styles.send, busy && styles.sendBusy]}
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <>
            <UploadIcon color={colors.primaryText} size={18} strokeWidth={2} />
            <Text style={styles.sendLabel}>{documentAction(slot)}</Text>
          </>
        )}
      </Pressable>

      {warnsAboutReplacing(slot) && (
        // **Verified only.** Replacing resets the review (ADR-0033 §2), and a
        // driver who has just been verified deserves to know before they
        // retake a photo out of habit. Under a *rejected* row the same
        // sentence discouraged exactly the action the office had asked for —
        // found by reading the rendered screen, not by a test.
        <Text style={styles.replaceWarning}>
          A new photo is checked again.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    flexShrink: 0,
  },
  badgeLabel: {
    ...typography.captionStrong,
  },
  cardNote: {
    ...typography.caption,
    color: colors.textMuted,
  },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSunken,
    marginTop: spacing.xs,
  },
  sendBusy: {
    opacity: 0.6,
  },
  sendLabel: {
    ...typography.button,
    fontSize: 16,
    color: colors.primaryText,
  },
  replaceWarning: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  blank: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  blankText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_HEIGHT,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryLabel: {
    ...typography.button,
    fontSize: 16,
    color: colors.primaryText,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    paddingTop: spacing.xs,
  },
});
