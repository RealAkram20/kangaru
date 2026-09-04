import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isApiError } from '../api/errors';
import type { ProfileStackParams } from '../navigation/types';
import { askedOn, closureStage, declineNotice } from '../profile/closure';
import {
  useClosureRequest,
  useRequestClosure,
  useWithdrawClosureRequest,
} from '../profile/closureQueries';
import { Button, Card, Field, Notice, Screen, ScreenHeader } from '../ui/components';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'CloseAccount'>;

/**
 * Deleting your account (ADR-0043).
 *
 * ## The one thing this screen must not do is lie
 *
 * The driver arrives looking for *delete*, and a hard delete **is not available
 * to this platform at any price**. `master-plan.md` §6 stakes the product on
 * reproducible invoices and an append-only ledger; a driver with completed
 * trips behind them cannot be erased without silently rewriting finished
 * invoices' subjects. That is not a limitation to work around — it is the
 * product.
 *
 * So the honest thing is said plainly, in the driver's own words, above the
 * button rather than in small print under it: **the account closes, the work
 * history stays, and the personal details go on the retention schedule.** A
 * button labelled *Delete* over a system that closes and retains is the kind of
 * lie a driver only discovers when it matters.
 *
 * ## It asks, it does not act
 *
 * ADR-0043 §1: the driver asks, a person at the office confirms. Not because a
 * confirmation dialog is insufficient, but because none of the reasons to look
 * first are knowable from the button — a driver may be owed money, holding the
 * office's cash, or mid-shift with a passenger in the car. *"Settle your
 * balance first"* is a better answer than an account that closes and strands a
 * fare.
 *
 * The consequence for this screen is the tense of every sentence on it. Nothing
 * says "your account will be deleted". The primary button asks.
 *
 * ## Three states, and the one that is unreachable
 *
 * **Nothing / withdrawn / declined** — the form, because all three mean the
 * driver may ask. A decline shows the office's reason above it (§4 makes that
 * reason required of them, so it is worth the space).
 *
 * **Pending** — what was asked and when, and a way to take it back. ADR-0032
 * left withdrawal out and recorded that its absence was more annoying than it
 * looked; changing your mind about closing your account is not an unusual
 * thing to do.
 *
 * **Confirmed** — drawn, and in practice never seen: confirming detaches the
 * sign-in, so the driver cannot reach this screen to read it. It exists because
 * the alternative is a screen offering to close an account that is closed, and
 * "unreachable" is a claim about today's auth rather than a guarantee.
 *
 * ## Why the answer arrives by email, and why this screen says so
 *
 * A confirmed closure has just taken away the only surface that could carry the
 * news (§4). A driver who is not told to watch their inbox will watch the app,
 * which by then cannot let them in.
 */
export function CloseAccountScreen({ navigation }: Props) {
  const { data: request, isLoading } = useClosureRequest();
  const ask = useRequestClosure();
  const withdraw = useWithdrawClosureRequest();

  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const stage = closureStage(request);
  const declined = declineNotice(request);
  const busy = ask.isPending || withdraw.isPending;

  const send = async () => {
    setProblem(null);

    try {
      await ask.mutateAsync(reason);
      setReason('');
    } catch (error) {
      if (!isApiError(error)) {
        setProblem('That did not reach the office. This needs a connection — try again.');

        return;
      }

      // Branching on `code`, never on the sentence. The race this exists for:
      // the office answered between the screen loading and the tap, so the
      // driver is looking at a form for a request that already exists.
      setProblem(
        error.code === 'CLOSURE_REQUEST_ALREADY_OPEN'
          ? 'You already have a request waiting. Pull down or reopen this screen to see it.'
          : error.message,
      );
    }
  };

  const confirmSend = () => {
    Alert.alert(
      'Ask the office to close your account?',
      'You can keep working until they answer, and you can take this back before they do.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Send request', style: 'destructive', onPress: () => void send() },
      ],
    );
  };

  const takeBack = async () => {
    setProblem(null);

    try {
      await withdraw.mutateAsync();
    } catch (error) {
      if (!isApiError(error)) {
        setProblem('That did not reach the office. This needs a connection — try again.');

        return;
      }

      setProblem(
        error.code === 'CLOSURE_REQUEST_ALREADY_DECIDED'
          ? 'The office has already answered this one. Reopen this screen to read what they said.'
          : error.message,
      );
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Delete account"
        subtitle={null}
        onBack={() => navigation.goBack()}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {problem !== null && <Notice message={problem} tone="danger" />}

          {declined !== null && <Notice message={declined} tone="warning" />}

          {/*
            First on the screen, before any control. A driver reading this is
            about to act on a word — "delete" — that does not mean here what it
            means everywhere else, and finding that out after the tap is finding
            it out too late.
          */}
          <Card>
            <Text style={styles.lead}>Closing your account is not the same as erasing it.</Text>

            <View style={styles.rule} />

            <Consequence
              tone="kept"
              text="Your trips, earnings and invoices stay with the office. They are the record your pay was worked out from, and the office cannot rewrite them."
            />
            <Consequence
              tone="lost"
              text="You stop being offered work, and you can no longer sign in on any device."
            />
            <Consequence
              tone="kept"
              text="Your name and phone number stay on your record while the office may still need to reach you about a final payment, then come off it."
            />
          </Card>

          {stage === 'closed' ? (
            <Notice
              tone="info"
              message="This account is closed. If you want to drive again, start a new application — your licence and documents need checking afresh."
            />
          ) : stage === 'pending' ? (
            <>
              <Card>
                <Text style={styles.waitingTitle}>Waiting for the office</Text>
                <Text style={styles.waitingBody}>{askedOn(request)}</Text>
                {/*
                  Said here rather than only in the email it refers to. A driver
                  who does not know to watch their inbox will watch the app —
                  which, the moment the office confirms, cannot let them in.
                */}
                <Text style={styles.waitingBody}>
                  They answer by email, because a closed account cannot sign in to be told.
                </Text>
              </Card>

              <Button
                label="Take my request back"
                tone="neutral"
                busy={withdraw.isPending}
                disabled={busy}
                onPress={() => void takeBack()}
              />
            </>
          ) : (
            <>
              <Card>
                <Field
                  label="Why are you leaving?"
                  hint="Optional. It helps the office answer, and nothing is held up if you skip it."
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  textAlignVertical="top"
                  style={styles.reason}
                />
              </Card>

              <Button
                label="Ask the office to close my account"
                tone="danger"
                busy={ask.isPending}
                // Not while the first read is in flight: a driver who taps
                // before the screen knows whether a request is already open
                // gets a 409 for asking a reasonable question.
                disabled={busy || isLoading}
                onPress={confirmSend}
              />
            </>
          )}

          <Button label="Keep my account" tone="neutral" onPress={() => navigation.goBack()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * One consequence, with a mark that says whether it is something kept or
 * something lost.
 *
 * The word "Kept"/"Lost" carries it, not the colour: `docs/screen-rules.md` §6
 * forbids meaning in colour alone, and this is the screen where a driver
 * misreading which is which costs them the most.
 */
function Consequence({ tone, text }: { tone: 'kept' | 'lost'; text: string }) {
  const kept = tone === 'kept';

  return (
    <View style={styles.consequence} accessible accessibilityLabel={`${kept ? 'Kept' : 'Lost'}. ${text}`}>
      <View style={[styles.tag, kept ? styles.tagKept : styles.tagLost]}>
        <Text style={[styles.tagText, kept ? styles.tagTextKept : styles.tagTextLost]}>
          {kept ? 'Kept' : 'Lost'}
        </Text>
      </View>

      <Text style={styles.consequenceText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    padding: spacing.md,
    gap: spacing.md,
  },
  lead: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  consequence: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    // Fixed, so the sentences start on one line down the card rather than
    // stepping in and out with the width of the word.
    minWidth: 52,
    alignItems: 'center',
  },
  tagKept: { backgroundColor: colors.primaryTint },
  tagLost: { backgroundColor: colors.dangerTint },
  tagText: { ...typography.caption },
  tagTextKept: { color: colors.primaryText },
  tagTextLost: { color: colors.danger },
  consequenceText: {
    ...typography.body,
    color: colors.textBody,
    flex: 1,
    lineHeight: 22,
  },
  reason: {
    // Three lines of room. A single-line box for a paragraph invites the
    // one-word answer the office cannot act on.
    minHeight: 88,
    paddingTop: spacing.sm,
  },
  waitingTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  waitingBody: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
});
