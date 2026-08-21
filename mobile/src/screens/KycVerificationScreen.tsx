import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DriverDocumentSlot, DriverDocumentType } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { DocumentSlotList } from '../documents/DocumentSlotList';
import { submitFootnote } from '../documents/grouping';
import { MediaPickerSheet, type PickedMedia } from '../documents/MediaPickerSheet';
import {
  listApplicationDocuments,
  uploadApplicationDocument,
  UploadTicketSpentError,
} from '../documents/applicationDocuments';
import { isoDate, warnsAboutReplacing } from '../profile/presentation';
import { Button, Notice, Screen } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
import { ChevronLeftIcon, LockIcon, ShieldCheckIcon } from '../ui/icons';
import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';

/**
 * The KYC screen, immediately after sign-up (ADR-0048 §4).
 *
 * ## Where this sits, and why it is not a step in the sign-up form
 *
 * The applicant has just submitted the form and holds no account — ADR-0027 §1
 * gives them nothing to sign in with. What they do hold is a claim ticket: 64
 * opaque characters that resolve to their one `driver_applications` row and
 * authorise three verbs on their own documents. That ticket is minted by the
 * submission, which is why this screen comes *after* the form rather than
 * being part of it.
 *
 * **The application is already in the office's queue before this screen
 * opens**, and that matters for how the button is worded. Every document here
 * is optional (ADR-0048 §6): an applicant who uploads nothing is in the queue
 * on exactly the same terms as one who uploads six. *Submit for Review*
 * submits the **documents**, not the application, and the footnote under it
 * says so rather than leaving somebody to infer that skipping means starting
 * over.
 *
 * ## Three ways this screen differs from the mockup, all deliberate
 *
 * 1. **"Not sent yet" is neutral, not red.** Six red rows on the first screen
 *    after sign-up read as six faults when nothing has gone wrong. Red is kept
 *    for a document the office actually refused. Raised with the owner and
 *    decided by them, not substituted quietly — see `DocumentSlotList`.
 * 2. **The driving licence draws `id-card`, not a steering wheel.** Lucide has
 *    no steering wheel and DESIGN.md §7 makes an absent glyph a design
 *    conversation rather than a licence to draw one.
 * 3. **The security panel says what is true.** The mockup promised
 *    encryption; nothing encrypted anything. Rather than print it or drop it,
 *    the encryption was built (ADR-0053), so the sentence is now a fact about
 *    the storage rather than a reassurance about it.
 *
 * ## Losing the ticket is a dead end, and says so
 *
 * The ticket lives 24 hours and dies the moment the office decides. There is
 * no way to ask for another — an endpoint that reissued one would take an
 * email address and answer whether an application existed for it, which is the
 * enumeration oracle ADR-0027 §5 refuses. So a spent ticket ends the screen
 * with the honest instruction: you are in the queue, send your papers from the
 * app once you are approved.
 */
export function KycVerificationScreen({
  uploadToken,
  phone,
  onDone,
}: {
  /** Minted by the submission, returned exactly once. */
  uploadToken: string;
  /** For the confirmation copy — the number the office will ring. */
  phone: string;
  /** Leaves KYC behind. The application stays in the queue either way. */
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { api } = useAuth();

  const [slots, setSlots] = useState<DriverDocumentSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<DriverDocumentType | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  /** The slot whose picker sheet is open, if any. */
  const [picking, setPicking] = useState<DriverDocumentSlot | null>(null);

  /**
   * A photograph waiting for the one thing the server will not accept it
   * without.
   *
   * Held here rather than uploaded immediately, because a driving licence and
   * an insurance certificate are refused without an expiry date (ADR-0033 §3)
   * — and finding that out *after* the upload, as a validation error on a
   * photo already taken, is the worst possible order to learn it in.
   */
  const [staged, setStaged] = useState<{ type: DriverDocumentType; uri: string } | null>(null);

  /**
   * The client, held by reference so it cannot re-key the load.
   *
   * `load` below is a dependency of a mount effect, and an effect keyed on a
   * *collaborator's identity* rather than on the thing it is loading re-runs
   * whenever that collaborator is re-created. `AuthProvider` memoises `api`
   * today, so this is latent in production — and it was not latent under test,
   * where it re-fetched on every render and wiped the error banner a failed
   * upload had just set. Found by instrumenting a failing test rather than by
   * reading the code.
   *
   * The ref is synchronised in an effect rather than assigned during render:
   * a ref written in render is invisible to React's memoisation and silently
   * opts the component out of it.
   */
  const apiRef = useRef(api);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  // Keyed on the ticket alone, because the ticket is the only thing that
  // decides *what* is loaded.
  const load = useCallback(async () => {
    try {
      setSlots(await listApplicationDocuments(apiRef.current, uploadToken));
      setProblem(null);
    } catch (error) {
      if (error instanceof UploadTicketSpentError) {
        setSpent(true);
      } else {
        setProblem('Could not load your documents. This needs a connection.');
      }
    } finally {
      setLoading(false);
    }
  }, [uploadToken]);

  /*
    A plain fetch-on-mount, and **deliberately not `useQuery`** even though
    every other screen in this app uses it.

    `App.tsx` wraps the client in `PersistQueryClientProvider` with no
    `shouldDehydrateQuery` filter, so every successful query — key and data —
    is written to AsyncStorage for 24 hours. Keying a query by the upload
    token would therefore persist a live credential for somebody's identity
    documents onto the handset's disk, where it long outlives the screen that
    needed it. Caching is also worth nothing here: this list is read once, by
    a person who will never see it again.

    This needed an eslint-disable until `load` stopped depending on `api`.
    Keying it on the ticket alone is what made the rule stop firing, which is
    the better outcome: the lint was pointing at a real defect rather than at a
    style, and the fix was to stop re-keying the effect on a collaborator's
    identity.
  */
  useEffect(() => {
    void load();
  }, [load]);

  const send = async (type: DriverDocumentType, uri: string, expiresAt: string | null) => {
    setBusyType(type);
    setProblem(null);

    try {
      await uploadApplicationDocument(apiRef.current, uploadToken, { type, uri, expiresAt });
      await load();
    } catch (error) {
      if (error instanceof UploadTicketSpentError) {
        setSpent(true);
      } else {
        // "Not queued" is the load-bearing half: every other mutation in this
        // app survives a dead zone (ADR-0023) and this one does not.
        setProblem('Not sent — documents need a connection. They are not queued.');
      }
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

  if (spent) {
    return (
      <Screen>
        <Header onBack={onDone} topInset={insets.top} />
        <View style={[styles.body, styles.centred]}>
          <Text style={styles.doneTitle}>This upload link has expired</Text>
          <Text style={styles.doneBody}>
            Your application is still with the office. Once you are approved, sign in and send your
            documents from your profile.
          </Text>
          <Button label="Done" onPress={onDone} />
        </View>
      </Screen>
    );
  }

  if (submitted) {
    return (
      <Screen>
        <View style={[styles.body, styles.centred, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.hero}>
            <ShieldCheckIcon color={colors.primary} size={38} strokeWidth={1.8} />
          </View>
          <Text
            style={styles.doneTitle}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            Application received
          </Text>
          <Text style={styles.doneBody}>
            The office will review it and call you on {phone}. Bring your driving licence when they
            do — approval needs it.
          </Text>
          <Button label="Back to sign in" onPress={onDone} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header onBack={onDone} topInset={insets.top} />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <View style={styles.hero}>
            <ShieldCheckIcon color={colors.primary} size={38} strokeWidth={1.8} />
          </View>

          <Text style={styles.title} accessibilityRole="header">
            Let&rsquo;s verify your identity
          </Text>
          <Text style={styles.subtitle}>
            This helps us keep the platform safe and secure for everyone.
          </Text>
        </View>

        {problem !== null && <Notice message={problem} tone="danger" />}

        {loading && slots.length === 0 ? (
          <SkeletonCards count={3} />
        ) : (
          <DocumentSlotList slots={slots} busyType={busyType} onOpen={setPicking} />
        )}

        {/*
          The mockup's reassurance panel, and every clause in it is now true:
          the bytes are encrypted at rest (ADR-0053), the file is served only
          through an authenticated, policy-checked controller and never as a
          URL (ADR-0033 §5), and a refused application's documents are
          destroyed (ADR-0048 §5).

          It was very nearly shipped as decoration. Nothing encrypted anything
          when this screen was drawn, and the panel would have told a stranger
          handing over their national ID a thing that was not so.
        */}
        <View style={styles.secure}>
          <View style={styles.secureIcon}>
            <LockIcon color={colors.primaryText} size={22} strokeWidth={1.8} />
          </View>
          <View style={styles.secureText}>
            <Text style={styles.secureTitle}>Your data is secure</Text>
            <Text style={styles.secureBody}>
              Your documents are encrypted, and only the office can open them — to check your
              account and nothing else.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button label="Submit for Review" onPress={() => setSubmitted(true)} />
        <Text style={styles.footnote}>{submitFootnote(slots)}</Text>
      </View>

      {picking !== null && (
        <MediaPickerSheet
          title={picking.type_label}
          note={warnsAboutReplacing(picking) ? 'A new photo is checked again.' : null}
          onPicked={(media) => picked(picking, media)}
          onClose={() => setPicking(null)}
          onRefused={setProblem}
        />
      )}

      {staged !== null && (
        <DateTimePicker
          // The picker is a native module with no text and no accessible name
          // of its own, so there is nothing else a test can find it by — the
          // convention `DocumentsScreen` and `TransactionsScreen` both use.
          testID="expiry-picker"
          value={new Date()}
          mode="date"
          // A document cannot expire in the past and still be worth sending;
          // the server refuses it, and a control that simply cannot ask the
          // question is better than a validation error.
          minimumDate={new Date()}
          /*
            `onValueChange` + `onDismiss`, not the deprecated single `onChange`.
            Cancelling on Android fired `onChange` with `dismissed` *and the
            value unchanged*, so every call site had to hand-check
            `event.type` — and getting that wrong uploads a document against a
            date the driver rejected. The library decides which happened now.
          */
          onValueChange={(_event, selected) => {
            const pending = staged;

            // Dropped with the date. Retaking a photo is cheap; holding it
            // would leave the row in a state nobody asked for.
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

/**
 * The mockup's header: a back arrow, and the title centred in brand green.
 *
 * Drawn here rather than through `ui/components`' `ScreenHeader`, which is
 * left-aligned and near-navy. That is not a fork — the onboarding screens
 * already draw their own chrome for the same reason (`WelcomeScreen` and
 * `SignUpScreen` both use `BackButton` rather than the header). This stack
 * sits outside the drawer and reads as a flow rather than as a place.
 *
 * Green at this size is correct: `brand-green` fails AA for body text and
 * passes comfortably for a 20pt semibold heading (DESIGN.md §1), which is why
 * `primary` is used here and `primaryText` everywhere smaller.
 */
function Header({ onBack, topInset }: { onBack: () => void; topInset: number }) {
  return (
    <View style={[styles.header, { paddingTop: topInset + spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        hitSlop={10}
        style={styles.headerBack}
      >
        <ChevronLeftIcon color={colors.text} size={26} strokeWidth={2.2} />
      </Pressable>

      <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
        KYC Verification
      </Text>

      {/* Balances the arrow so the title is optically centred rather than
          centred in the space the arrow left over. */}
      <View style={styles.headerBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.heading,
    color: colors.primary,
    flex: 1,
    textAlign: 'center',
  },
  body: {
    padding: spacing.md,
    gap: spacing.lg,
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  intro: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  hero: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.title,
    fontSize: 24,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  secure: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  secureIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  secureText: {
    flexShrink: 1,
    gap: 2,
  },
  secureTitle: {
    ...typography.captionStrong,
    fontSize: 15,
    color: colors.primaryText,
  },
  secureBody: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textBody,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footnote: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  doneTitle: {
    ...typography.heading,
    color: colors.text,
    textAlign: 'center',
  },
  doneBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  retry: {
    minHeight: MIN_TOUCH_HEIGHT,
  },
});
