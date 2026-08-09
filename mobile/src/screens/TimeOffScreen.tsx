import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AvailabilityBlock, AvailabilityKind } from '../api/types';
import { useSync } from '../offline/SyncProvider';
import { useAvailabilityRequests } from '../trips/queries';
import { Button, Card, Empty, Field, Notice, Screen, StatusPill } from '../ui/components';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, spacing, typography } from '../ui/theme';

/**
 * Asking the office for time off, and seeing what they said.
 *
 * ADR-0017 §6 shapes this screen more than anything the app decides:
 *
 * - The request carries **no `resource_id` and no `status`** — both are pinned
 *   by the server to the caller and to `requested`. There is nothing here to
 *   choose whose leave this is, by design.
 * - **Asking is not being granted.** Only an `approved` answer withholds a
 *   driver from dispatch, so the screen never implies otherwise: a pending row
 *   says "waiting for an answer" and nothing more.
 * - A request can be **withdrawn only while unanswered**. Once the office has
 *   decided, the server refuses with `AVAILABILITY_ALREADY_ANSWERED`, so the
 *   button disappears rather than failing.
 */
const KINDS: { value: AvailabilityKind; label: string }[] = [
  { value: 'leave', label: 'Leave' },
  { value: 'sick', label: 'Sick' },
  { value: 'rest', label: 'Rest day' },
  { value: 'training', label: 'Training' },
  { value: 'other', label: 'Other' },
];

export function TimeOffScreen() {
  const { data: requests, isError, dataUpdatedAt } = useAvailabilityRequests();
  const { queueAvailabilityRequest, queueAvailabilityWithdrawal } = useSync();

  const [kind, setKind] = useState<AvailabilityKind>('leave');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const startError = validateDate(startsAt, true);
  const endError = validateDate(endsAt, false);
  // `reason` is min:5 on the server. Caught here so a driver does not discover
  // it from a parked queue item.
  const reasonError = reason.trim().length > 0 && reason.trim().length < 5
    ? 'Please say a little more — at least five characters.'
    : undefined;

  const canSubmit =
    startError === undefined &&
    endError === undefined &&
    reasonError === undefined &&
    startsAt !== '' &&
    reason.trim().length >= 5;

  const submit = async () => {
    if (!canSubmit) {
      return;
    }

    setBusy(true);

    await queueAvailabilityRequest({
      kind,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt === '' ? null : new Date(endsAt).toISOString(),
      reason: reason.trim(),
    });

    setBusy(false);
    setSubmitted(true);
    setStartsAt('');
    setEndsAt('');
    setReason('');
  };

  const withdraw = (block: AvailabilityBlock) => {
    Alert.alert('Withdraw this request?', 'The office will no longer see it.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: () => void queueAvailabilityWithdrawal(block.id),
      },
    ]);
  };

  return (
    <Screen>
      <SyncBanner />

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.sectionTitle}>Ask for time off</Text>

          {submitted && (
            <Notice
              tone="info"
              message="Sent to the office. You are still on the roster until they approve it."
            />
          )}

          <Text style={styles.fieldLabel}>Reason type</Text>
          <View style={styles.kinds}>
            {KINDS.map((option) => (
              <View key={option.value} style={styles.kindButton}>
                <Button
                  label={option.label}
                  tone={kind === option.value ? 'primary' : 'neutral'}
                  onPress={() => setKind(option.value)}
                />
              </View>
            ))}
          </View>

          <Field
            label="From"
            hint="YYYY-MM-DD"
            value={startsAt}
            onChangeText={setStartsAt}
            placeholder="2026-08-14"
            keyboardType="numbers-and-punctuation"
            error={startsAt === '' ? undefined : startError}
          />

          <Field
            label="Until"
            hint="Leave blank if you do not know yet — the office will set the end date."
            value={endsAt}
            onChangeText={setEndsAt}
            placeholder="2026-08-18"
            keyboardType="numbers-and-punctuation"
            error={endsAt === '' ? undefined : endError}
          />

          <Field
            label="Why"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            placeholder="Family funeral in Mbarara"
            error={reasonError}
          />

          <Button label="Send request" busy={busy} disabled={!canSubmit} onPress={() => void submit()} />
        </Card>

        <Text style={styles.sectionTitle}>Your requests</Text>

        {isError && dataUpdatedAt === 0 && (
          <Notice message="Could not reach the office. Anything you send is saved and will go out later." />
        )}

        {(requests ?? []).length === 0 ? (
          <Empty message="You have not asked for any time off." />
        ) : (
          (requests ?? []).map((block) => (
            <Card key={block.id}>
              <View style={styles.requestHeader}>
                <StatusPill
                  label={answerLabel(block)}
                  tone={block.status === 'approved' ? 'done' : 'neutral'}
                />
                <Text style={styles.kindLabel}>{labelForKind(block.kind)}</Text>
              </View>

              <Text style={styles.dates}>
                {formatDate(block.starts_at)}
                {block.ends_at === null ? ' — open ended' : ` to ${formatDate(block.ends_at)}`}
              </Text>

              {block.reason !== null && <Text style={styles.reason}>{block.reason}</Text>}

              {block.answer_note !== null && (
                <Text style={styles.answerNote}>Office: {block.answer_note}</Text>
              )}

              {block.status === 'requested' && (
                <View style={styles.withdraw}>
                  <Button label="Withdraw" tone="neutral" onPress={() => withdraw(block)} />
                </View>
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * Says what the office decided, in the words a driver would use. "Requested"
 * is rendered as a wait rather than a state, because the difference between
 * "I asked" and "I have it" is the one thing a driver must not misread — only
 * `approved` takes them off the roster.
 */
function answerLabel(block: AvailabilityBlock): string {
  if (block.status === 'approved') {
    return 'Approved';
  }

  return block.status === 'declined' ? 'Declined' : 'Waiting for an answer';
}

function labelForKind(kind: AvailabilityBlock['kind']): string {
  return KINDS.find((option) => option.value === kind)?.label ?? kind;
}

function validateDate(value: string, required: boolean): string | undefined {
  if (value === '') {
    return required ? 'Enter a date.' : undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    return 'Use the form 2026-08-14.';
  }

  return undefined;
}

function formatDate(value: string | null): string {
  if (value === null) {
    return '—';
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? '—' : new Date(parsed).toLocaleDateString();
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  kinds: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  kindButton: {
    minWidth: 100,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  kindLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  dates: {
    ...typography.body,
    color: colors.text,
  },
  reason: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  answerNote: {
    ...typography.caption,
    color: colors.text,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  withdraw: {
    marginTop: spacing.md,
  },
});
