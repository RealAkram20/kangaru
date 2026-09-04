import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { isApiError } from '../api/errors';
import type { ProfileStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import { findHelpTopic } from '../support/topics';
import { useCreateSupportRequest } from '../support/queries';
import { Button, Card, Field, Notice, Screen, ScreenHeader } from '../ui/components';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'ReportIssue'>;

/**
 * Writing a report to the office (ADR-0044).
 *
 * ## The screen the five Help Topics rows were pretending to have
 *
 * Before this, all five opened the same contact card and nothing a driver
 * typed reached anybody. The owner's words for that were *"repeated and
 * fake"*. This is the honest version: what they write is stored, a person at
 * the office answers it, and the answer comes back to their inbox.
 *
 * ## Why the topic is fixed and not a picker
 *
 * The driver chose it on the previous screen by tapping a row. Re-asking here
 * would be the app forgetting what it was just told, and a picker defaulting to
 * "Report an issue" is how every report ends up in the catch-all bucket the
 * office has to sort by hand.
 *
 * ## Why the prompts are above the box and not placeholder text
 *
 * They must survive typing. A placeholder listing what the office needs
 * vanishes at the first character — exactly when it starts being useful — and a
 * driver halfway through an account of a passenger dispute cannot get it back
 * without deleting what they wrote.
 *
 * ## Why this refuses to send offline instead of queueing
 *
 * ADR-0044 §5. ADR-0023's outbox exists so a driver in a dead zone loses no
 * *work*; a report is not work, it is a message somebody is waiting on an
 * answer to. Queueing it would tell them the office has it while it sat on the
 * handset, and the first they would know is the silence.
 */
export function ReportIssueScreen({ navigation, route }: Props) {
  const topic = findHelpTopic(route.params?.topic);
  const { online } = useSync();
  const send = useCreateSupportRequest();

  const [body, setBody] = useState('');

  const trimmed = body.trim();
  // The server's floor, checked here so a driver learns it from the form
  // rather than from a rejection — the same courtesy `TimeOffScreen` pays.
  const tooShort = trimmed.length > 0 && trimmed.length < 10;
  const canSend = trimmed.length >= 10 && !send.isPending;

  const submit = () => {
    if (!canSend || topic === null) {
      return;
    }

    send.mutate(
      { topic: topic.key, body: trimmed },
      {
        onSuccess: () => {
          /*
            Straight to the list, replacing this screen rather than pushing
            onto it. A driver who backs out of the confirmation must not land
            on a filled-in form they have already sent — that is how the same
            report gets filed twice.
          */
          navigation.replace('MyReports');
        },
      },
    );
  };

  /*
    A topic that does not resolve is a stale deep link from an older build, not
    a state worth building a screen for. `findHelpTopic` already degrades to
    null rather than throwing; this says so and offers the way out.
  */
  if (topic === null) {
    return (
      <Screen>
        <ScreenHeader title="Report an issue" subtitle={null} onBack={() => navigation.goBack()} />
        <View style={styles.body}>
          <Notice
            tone="warning"
            message="That topic is no longer available. Go back and choose one from Help & Safety."
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={topic.label} subtitle={null} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>{topic.summary}</Text>

        {/*
          Stated before the box, not after a failure. A driver types an account
          of something that happened to them, taps Send, and finding out then
          that it never left the phone is the worst moment to learn it.
        */}
        {!online && (
          <Notice
            tone="warning"
            message="No connection. A report is sent straight to the office, so this one needs signal — your work is still saved as usual."
          />
        )}

        {send.isError && (
          <Notice
            tone="danger"
            message={
              // The server's own sentence where there is one — it knows
              // whether the trip was wrong or the text too long, and inventing
              // a second vocabulary for its answers is how two error messages
              // for one cause come about.
              isApiError(send.error)
                ? send.error.message
                : 'Could not send your report. Check your connection and try again.'
            }
          />
        )}

        <Card>
          <Text style={styles.sectionTitle}>Include if you can</Text>

          {/*
            The topic's own prompts, which until now were a list to read before
            dialling the office. They are questions rather than fields: a form
            with three required boxes would refuse a report from the driver who
            cannot answer one of them, and a report the office can only
            half-action is worth far more than none.
          */}
          <View style={styles.prompts}>
            {topic.prepare.map((prompt) => (
              <View key={prompt} style={styles.prompt}>
                <Text style={styles.promptBullet}>{'•'}</Text>
                <Text style={styles.promptText}>{prompt}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Field
          label="What happened"
          hint="In your own words. The office reads this exactly as you write it."
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          style={styles.textArea}
          autoCapitalize="sentences"
          editable={!send.isPending}
          error={tooShort ? 'Add a little more so the office can act on it.' : undefined}
        />

        <Button
          label="Send to the office"
          onPress={submit}
          disabled={!canSend}
          busy={send.isPending}
        />

        {/*
          **Promises no time**, deliberately. There is no SLA (ADR-0044 §5), and
          "within 24 hours" here would be this screen committing somebody else's
          desk to a deadline nothing enforces.
        */}
        <Text style={styles.note}>
          A person at the office reads this and writes back. Their answer appears in Your reports,
          and you will get a notification.
        </Text>

        {/* The other channel, named rather than hidden (ADR-0044 §6). Somebody
            whose vehicle has just been hit should not be filling in a form. */}
        <Text style={styles.note}>If it is happening right now, call instead — Help & Safety has the number.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  lead: {
    ...typography.body,
    color: colors.textBody,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  prompts: {
    gap: spacing.sm,
  },
  prompt: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  promptBullet: {
    ...typography.body,
    color: colors.textMuted,
  },
  promptText: {
    ...typography.body,
    color: colors.textBody,
    flex: 1,
  },
  /**
   * A real box, not a one-line input that scrolls sideways.
   *
   * 160pt is about eight lines on a 393dp screen: enough that a driver can see
   * what they have written while they write the next sentence, which is the
   * difference between an account somebody re-reads and one they abandon.
   */
  textArea: {
    minHeight: 160,
    paddingTop: spacing.sm + 2,
    borderRadius: radius.md,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
