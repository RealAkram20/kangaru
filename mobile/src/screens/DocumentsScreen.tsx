import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DriverDocumentSlot, DriverDocumentType } from '../api/endpoints';
import type { ProfileStackParams } from '../navigation/types';
import { useDriverDocuments, useUploadDocument } from '../profile/queries';
import { documentsSummary, pickerSheetNote } from '../profile/presentation';
import { DocumentSlotList } from '../documents/DocumentSlotList';
import { ExpiryDatePicker } from '../documents/ExpiryDatePicker';
import { MediaPickerSheet, type PickedMedia } from '../documents/MediaPickerSheet';
import { Notice, Screen, ScreenHeader } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
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

  /** The slot whose picker sheet is open, if any. */
  const [picking, setPicking] = useState<DriverDocumentSlot | null>(null);

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

  /**
   * A picture is chosen on the sheet, not by the camera opening unasked.
   *
   * This screen used to launch the camera directly, which was fine until the
   * driver whose insurance certificate is already a photograph in their
   * gallery — scanned at the office, sent by their broker — had no way to send
   * it. `MediaPickerSheet` offers both and is shared with the applicant's KYC
   * screen, so the two cannot drift into offering different things.
   */
  const picked = (slot: DriverDocumentSlot, media: PickedMedia) => {
    setProblem(null);

    if (slot.requires_expiry) {
      setStaged({ type: slot.type, uri: media.uri });

      return;
    }

    void send(slot.type, media.uri, null);
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
          /*
            The mockup's grouped layout, shared with the applicant's KYC screen
            (ADR-0048 §1). One list rather than two: an applicant filling this
            in before approval and a driver filling it in after are doing the
            same thing, and the four hand-built cards that stood here would
            have been the copy that drifted.
          */
          <DocumentSlotList slots={slots} busyType={busyType} onOpen={setPicking} />
        )}

        {/*
          The footnote that stood here — "The office checks each one by hand…
          Your work is not blocked while one waits" — said in twenty-one words
          what each card's own status chip says by existing.
        */}
      </ScrollView>

      {picking !== null && (
        <MediaPickerSheet
          title={picking.type_label}
          note={pickerSheetNote(picking)}
          onPicked={(media) => picked(picking, media)}
          onClose={() => setPicking(null)}
          onRefused={setProblem}
        />
      )}

      {staged !== null && (
        <ExpiryDatePicker
          onPicked={(expiresAt) => {
            const pending = staged;

            // Dropped with the date. Retaking a photo is cheap; holding it
            // would leave the card in a state the driver did not ask for.
            setStaged(null);

            if (pending !== null) {
              void send(pending.type, pending.uri, expiresAt);
            }
          }}
          onCancelled={() => setStaged(null)}
        />
      )}
    </Screen>
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
