import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';

import type { SettlementRequestKind } from '../api/endpoints';
import { Button, Field, Notice } from '../ui/components';
import { colors, radius, spacing, typography } from '../ui/theme';
import { kindAction, kindExplainer, parseAmount } from './settlement';
import { useCreateSettlementRequest } from './queries';

/**
 * Telling the office that cash moved, or asking it to (ADR-0032).
 *
 * ## What this is careful never to imply
 *
 * **It does not pay anybody.** The explainer says so before the driver types
 * a figure, and the confirmation says so again — a driver who believes
 * tapping a button transfers money is a driver who stops trusting the app the
 * first time nothing arrives.
 *
 * **It does not move the balance.** The wallet total comes from the ledger
 * alone; this request sits in a queue until a person confirms it. That is
 * ADR-0032 §2's safety property — if a request moved the balance, a driver
 * could request their way out of what they owe.
 *
 * ## Why it needs a connection
 *
 * Every trip transition in this app goes through the offline outbox, and this
 * deliberately does not. The outbox is right for a record of something that
 * already happened; this is a **message to a person**, and a queued one is
 * worse than a refused one — the driver walks away believing the office has
 * been told and finds out days later that it had not. The same call
 * `useSetDuty` and the password change make, for the same reason.
 *
 * A modal rather than a screen: it is a form completed or abandoned as a unit,
 * exactly like odometer capture, and backing out must leave nothing behind.
 */
export function SettlementSheet({
  kind,
  tripId,
  onClose,
}: {
  kind: SettlementRequestKind;
  /**
   * The trip a tip was taken on (ADR-0034 §1). **Required when `kind` is
   * `tip` and refused otherwise** — the server validates both halves, so a
   * stray one here is a 422 rather than a field quietly ignored.
   *
   * There is no trip *picker*: the sheet is opened from a screen that already
   * knows which trip it is about, which is what keeps a driver from declaring
   * a tip against the wrong job by mis-tapping a list.
   */
  tripId?: number;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');

  const create = useCreateSettlementRequest();

  const amount = parseAmount(typed);

  const submit = () => {
    if (amount === null) {
      return;
    }

    create.mutate(
      {
        kind,
        amountMinor: amount,
        note: note.trim() === '' ? null : note.trim(),
        ...(tripId === undefined ? {} : { tripId }),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={styles.title} accessibilityRole="header">
              {kindAction(kind)}
            </Text>
            <Text style={styles.explainer}>{kindExplainer(kind)}</Text>

            {create.isError && (
              <Notice
                tone="danger"
                message="That could not be sent. Check your connection and try again — nothing has been recorded."
              />
            )}

            <Field
              label="Amount"
              hint="Whole shillings."
              value={typed}
              // Digits only as they type. `parseAmount` strips separators too,
              // so a pasted "47,000" still works — this just stops the
              // keyboard offering a decimal point for a currency that has no
              // subunit.
              onChangeText={(text) => setTyped(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="47000"
              autoFocus
            />

            <Field
              label="Note"
              hint="Optional. Anything that helps the office recognise it."
              value={note}
              onChangeText={setNote}
              placeholder="Paid Musoke at Nakawa depot"
              maxLength={255}
            />

            <View style={styles.actions}>
              <Button
                label="Send to the office"
                busy={create.isPending}
                // Disabled rather than sending a 422 the driver has to read.
                disabled={amount === null}
                onPress={submit}
              />
              <Button label="Cancel" tone="neutral" onPress={onClose} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    // So the sheet reads as sitting over the wallet rather than replacing it
    // — the balance it concerns is still behind.
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  explainer: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
