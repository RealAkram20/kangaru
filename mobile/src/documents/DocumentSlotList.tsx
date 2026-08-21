import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DriverDocumentSlot, DriverDocumentType } from '../api/endpoints';
import {
  documentAction,
  documentAnnouncement,
  documentNote,
  documentState,
} from '../profile/presentation';
import {
  CarFrontIcon,
  CarIcon,
  ChevronRightIcon,
  ContactIcon,
  FileTextIcon,
  IdCardIcon,
  ScanFaceIcon,
  ShieldCheckIcon,
} from '../ui/icons';
import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';
import { documentGlyph, groupSlots, type DocumentGlyph } from './grouping';

/**
 * The six document rows, under the mockup's three headings.
 *
 * **One list, drawn by two screens** — the applicant's KYC screen before
 * approval and the signed-in Documents screen after it. ADR-0048 §4 makes them
 * the same act performed at two moments, and `DriverDocumentService` returns
 * the identical shape to both for exactly that reason; a second copy of these
 * rows is a second place for "which section is a selfie in" to be wrong.
 *
 * ## What a row says, and what it refuses to say
 *
 * The status word comes from `compliance_state`, never `status`. A verified
 * licence that lapsed last month still carries `status: 'verified'` because
 * nothing wrote to the row, and printing that would tell a driver their
 * expired licence is fine — the single most dangerous sentence this screen
 * could contain.
 *
 * ## The mockup paints every row's status red. This does not.
 *
 * *Not uploaded* on a first-run screen is not an error: nothing has gone
 * wrong, the driver has simply not started. Six red rows on the first screen
 * after sign-up reads as six faults, and — worse — it spends the colour that
 * means *the office rejected this* on the state that means *we have not asked
 * you yet*. Red is kept for a document actually refused or actually expired,
 * where it is the whole point. **Raised with the owner before it was built,
 * and this is their decision, not a quiet substitution.**
 *
 * Colour is never the carrier either way: every state has its own word
 * (`docs/screen-rules.md` §6), so the row reads correctly in greyscale, in
 * direct sun, and to somebody who cannot distinguish the two tints at all.
 */
export function DocumentSlotList({
  slots,
  busyType,
  onOpen,
}: {
  slots: DriverDocumentSlot[];
  /** The one row with an upload in flight, if any. */
  busyType: DriverDocumentType | null;
  onOpen: (slot: DriverDocumentSlot) => void;
}) {
  return (
    <>
      {groupSlots(slots).map((section) => (
        <View key={section.group} style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            {section.label}
          </Text>

          <View style={styles.card}>
            {section.slots.map((slot, index) => (
              <DocumentRow
                key={slot.type}
                slot={slot}
                busy={busyType === slot.type}
                first={index === 0}
                onPress={() => onOpen(slot)}
              />
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

function DocumentRow({
  slot,
  busy,
  first,
  onPress,
}: {
  slot: DriverDocumentSlot;
  busy: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const state = documentState(slot);

  const tint =
    state.tone === 'good'
      ? colors.primaryText
      : state.tone === 'danger'
        ? colors.danger
        : state.tone === 'warning'
          ? colors.warning
          : colors.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      // One sentence, composed, rather than four fragments a screen reader
      // linearises into disconnected values (`docs/screen-rules.md` §6).
      accessibilityLabel={documentAnnouncement(slot)}
      /*
        The verb the old button carried. The mockup's row has only a chevron,
        which is right for the eye — six rows of "Take a photo" is a column of
        repeated words — and wrong for a screen reader, which would otherwise
        announce six identical, unactionable rows. `documentAction` already
        distinguishes *take*, *replace* and *send it again*, and the last of
        those matters: the office has asked for that one back.
      */
      accessibilityHint={
        slot.requires_expiry
          ? `${documentAction(slot)}. You will be asked when it expires.`
          : documentAction(slot)
      }
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowDivided,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Glyph glyph={documentGlyph(slot.type)} />
      </View>

      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {slot.type_label}
        </Text>
        {/*
          The mockup has no second line. This one earns its place because it is
          where a rejection reason appears — the office's own words, which are
          the entire reason the server makes a reason mandatory. Without it a
          driver reads "Rejected" and has to guess what to fix.
        */}
        <Text style={styles.rowNote} numberOfLines={2}>
          {documentNote(slot)}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <>
          <Text style={[styles.rowState, { color: tint }]} numberOfLines={1}>
            {state.label}
          </Text>
          {/* Navigation chrome: static, per DESIGN.md §7. */}
          <ChevronRightIcon color={colors.placeholder} size={20} />
        </>
      )}
    </Pressable>
  );
}

/**
 * The row's glyph, resolved from the name `grouping.ts` chose.
 *
 * The `null` arm is not defensive padding — it is what makes a handset that
 * has never heard of a seventh document type still draw its row. The server's
 * enum can gain a case tomorrow; every installed app must survive it.
 */
function Glyph({ glyph }: { glyph: DocumentGlyph }) {
  const props = { color: colors.primaryText, size: 22, strokeWidth: 1.8 } as const;

  switch (glyph) {
    case 'contact':
      return <ContactIcon {...props} />;
    case 'scan-face':
      return <ScanFaceIcon {...props} />;
    case 'id-card':
      return <IdCardIcon {...props} />;
    case 'car':
      return <CarIcon {...props} />;
    case 'shield-check':
      return <ShieldCheckIcon {...props} />;
    case 'car-front':
      return <CarFrontIcon {...props} />;
    default:
      return <FileTextIcon {...props} />;
  }
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  heading: {
    ...typography.label,
    fontSize: 16,
    color: colors.text,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_HEIGHT + 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  rowIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    flexShrink: 0,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  rowLabel: {
    ...typography.body,
    color: colors.text,
  },
  rowNote: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textMuted,
  },
  rowState: {
    ...typography.captionStrong,
    flexShrink: 0,
    textAlign: 'right',
  },
});
