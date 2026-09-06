import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DriverDocumentSlot, DriverDocumentType } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import {
  listMyApplicationDocuments,
  uploadMyApplicationDocument,
} from '../documents/applicationDocuments';
import { DocumentSlotList } from '../documents/DocumentSlotList';
import { ExpiryDatePicker } from '../documents/ExpiryDatePicker';
import { MediaPickerSheet, type PickedMedia } from '../documents/MediaPickerSheet';
import { pickerSheetNote } from '../profile/presentation';
import { Button, Notice, Screen } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
import { ClockIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';

/**
 * Where an applicant lands when they sign in (ADR-0057 §5).
 *
 * ## Why this screen exists at all
 *
 * Until §5 an applicant had no account, so signing in was impossible and the
 * only way back to their documents was a claim ticket that
 * `RootNavigator` deliberately throws away. Now they hold an account from the
 * moment they apply — and an account with nowhere to go is worse than none,
 * because it invites somebody to sign in and find an app that 404s every
 * screen.
 *
 * ## What it is for, in one sentence
 *
 * The office refused one document and asked them to send another; this is
 * where they see which, why, and do it. Everything else is deliberately
 * absent — there is no work to show somebody who has not been approved.
 *
 * ## The copy is short on purpose
 *
 * One line of status and the document list. An applicant reading this has
 * already been told the detail by email; repeating it here would bury the
 * one row they came to fix. `DocumentSlotList` carries the office's reason
 * on the row it belongs to, which is the only place it means anything.
 */
export function ApplicationPendingScreen() {
  const insets = useSafeAreaInsets();
  const { api, signOut } = useAuth();

  const [slots, setSlots] = useState<DriverDocumentSlot[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyType, setBusyType] = useState<DriverDocumentType | null>(null);
  const [picking, setPicking] = useState<DriverDocumentSlot | null>(null);
  const [staged, setStaged] = useState<{ type: DriverDocumentType; uri: string } | null>(null);

  /*
   * Held by reference, for the reason `KycVerificationScreen` documents: an
   * effect keyed on a collaborator's identity re-runs whenever that
   * collaborator is rebuilt, and this one would wipe the error a failed
   * upload had just set.
   */
  const apiRef = useRef(api);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const load = useCallback(async () => {
    try {
      setSlots(await listMyApplicationDocuments(apiRef.current));
      setProblem(null);
    } catch {
      setProblem('Could not load your documents. This needs a connection.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (type: DriverDocumentType, uri: string, expiresAt: string | null) => {
    setBusyType(type);
    setProblem(null);

    try {
      await uploadMyApplicationDocument(apiRef.current, { type, uri, expiresAt });
      await load();
    } catch {
      // The same sentence the KYC screen uses, and the same reason: this
      // upload is not queued, and saying so is the honest half.
      setProblem('Not sent — documents need a connection. They are not queued.');
    } finally {
      setBusyType(null);
    }
  };

  const picked = (slot: DriverDocumentSlot, media: PickedMedia) => {
    if (slot.requires_expiry) {
      setStaged({ type: slot.type, uri: media.uri });

      return;
    }

    void send(slot.type, media.uri, null);
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.status} accessibilityRole="summary">
          <View style={styles.badge}>
            <ClockIcon size={20} color={colors.primary} />
          </View>
          <View style={styles.statusText}>
            <Text style={styles.title} accessibilityRole="header">
              With the office
            </Text>
            {/*
              No date, no queue position, no estimate. The platform produces
              none of them, and `docs/screen-rules.md` §1 forbids inventing a
              value a screen cannot get — an applicant told "2 days" who waits
              five has been lied to about the only thing they cared about.
            */}
            <Text style={styles.subtitle}>
              We will call you when your application has been checked.
            </Text>
          </View>
        </View>

        {problem !== null && <Notice tone="danger" message={problem} />}

        {slots === null ? (
          <SkeletonCards count={3} />
        ) : (
          <DocumentSlotList slots={slots} busyType={busyType} onOpen={setPicking} />
        )}

        <Button label="Sign out" tone="neutral" onPress={() => void signOut()} />
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    flex: 1,
    gap: spacing.xs,
  },
  title: typography.title,
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
  },
});
