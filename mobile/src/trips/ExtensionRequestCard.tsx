import { StyleSheet, Text, View } from 'react-native';

import type { TripStop } from '../api/types';
import { Button, Card } from '../ui/components';
import { CheckIcon, XIcon } from '../ui/icons';
import { colors, spacing, typography } from '../ui/theme';

/**
 * The passenger has asked to be taken further, and the driver has to answer.
 *
 * ## Why it is a card and not a notice
 *
 * `Notice` states a fact the driver cannot act on — *"on hold, waiting time
 * is recorded"*. This is a question with two answers, and the person it is
 * addressed to is driving. It needs the two buttons in the same place the eye
 * lands, at the top of the screen, not a sentence somewhere with the actions
 * elsewhere.
 *
 * ## Why the label is the whole content
 *
 * The place is the only thing the decision turns on. A driver deciding
 * whether to carry somebody on to Kabalagala needs to know it is Kabalagala;
 * they already know who is in the car, what the fare basis is, and that the
 * trip is running. `docs/screen-rules.md` §9 — everything else would be the
 * screen explaining itself to somebody mid-task.
 *
 * There is deliberately no fare figure. Nothing on this platform can price an
 * extension before it is driven: the fare follows measured distance, and a
 * quote made up here would be a number the driver repeats to a passenger and
 * cannot honour (§1).
 */
export function ExtensionRequestCard({
  request,
  busy,
  onAccept,
  onDecline,
}: {
  request: TripStop;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Card style={styles.card}>
      <View
        // One announcement rather than four fragments. A screen reader
        // linearising heading, place and two buttons reads as a list of
        // disconnected nouns; this says the whole question at once.
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Your passenger has asked to go on to ${request.label}.`}
      >
        <Text style={styles.heading}>Passenger wants to go further</Text>
        <Text style={styles.place}>{request.label}</Text>
      </View>

      <View style={styles.actions}>
        {/*
          Decline first in the source, Accept second — so the destructive
          answer is never the one under a thumb already travelling toward the
          primary. The two are equal weight on screen: this is a question,
          and a card that visually pre-answers it is not asking.
        */}
        <View style={styles.action}>
          <Button
            label="Decline"
            tone="neutral"
            busy={busy}
            onPress={onDecline}
            icon={<XIcon size={16} />}
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Accept"
            tone="primary"
            busy={busy}
            onPress={onAccept}
            icon={<CheckIcon size={16} />}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  heading: {
    ...typography.label,
    color: colors.textMuted,
  },
  place: {
    // The one fact the decision turns on, at heading size: read from a cradle
    // at arm's length, in direct sun, by somebody who is driving.
    ...typography.heading,
    color: colors.text,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
