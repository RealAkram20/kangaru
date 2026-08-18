import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SupportRequest } from '../api/endpoints';
import type { ProfileStackParams } from '../navigation/types';
import { whenLabel } from '../notifications/presentation';
import { useSupportRequests } from '../support/queries';
import { Card, Empty, Notice, Screen, ScreenHeader } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'MyReports'>;

/**
 * What the driver told the office, and what the office said back (ADR-0044).
 *
 * ## This screen is the feature
 *
 * A report queue with no way to read the answer is the half-built loop
 * `master-plan.md` §2 exists to refuse — and it is the half that gets skipped,
 * because the form feels like the feature. Everything here is in service of one
 * question: *did anybody answer me?*
 *
 * ## Waiting is a real state and says so
 *
 * `answer === null` means the office still owes one. It cannot mean "refused
 * quietly": ADR-0044 §2 removed the status that would have allowed that, so a
 * report either has an answer or is still in somebody's queue. The row says
 * which in words — `docs/screen-rules.md` §6 — rather than by colour alone.
 *
 * ## Why the driver's own words are shown in full
 *
 * A driver checking on a report is checking what they *said*, and a truncated
 * account is one they cannot verify. These are a few short paragraphs each and
 * there are rarely more than a handful; the room is affordable and the
 * alternative is a list of identical first lines.
 */
export function MyReportsScreen({ navigation }: Props) {
  const { data, isLoading, isError, refetch, isRefetching } = useSupportRequests();

  const reports = data ?? [];

  return (
    <Screen>
      <ScreenHeader title="Your reports" subtitle={null} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        testID="reports-scroll"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading && <SkeletonCards count={2} />}

        {/*
          The cache is served offline, so an error with rows behind it is a
          stale list rather than a broken screen — and the two must not look
          the same. This says which one the driver is looking at.
        */}
        {isError && (
          <Notice
            tone={reports.length > 0 ? 'warning' : 'danger'}
            message={
              reports.length > 0
                ? 'Showing what was saved on this phone. Could not reach the office.'
                : 'Could not load your reports.'
            }
          />
        )}

        {!isLoading && !isError && reports.length === 0 && (
          <Empty message="You have not reported anything yet. Help & Safety is where you start one." />
        )}

        {reports.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </ScrollView>
    </Screen>
  );
}

function ReportCard({ report }: { report: SupportRequest }) {
  const answered = report.answer !== null;

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.topic}>{report.topic_label}</Text>

        {/*
          The status in words, in a pill whose colour repeats it rather than
          carries it. A driver who cannot separate the hues reads exactly the
          same fact.
        */}
        <View style={[styles.pill, answered ? styles.pillAnswered : styles.pillWaiting]}>
          <Text style={[styles.pillText, answered ? styles.pillTextAnswered : styles.pillTextWaiting]}>
            {report.status_label}
          </Text>
        </View>
      </View>

      <Text style={styles.when}>{whenLabel(report.created_at)}</Text>

      <Text style={styles.reportText}>{report.body}</Text>

      {answered ? (
        /*
          The answer sits in its own block with the office named as its author,
          because the two texts on this card were written by different people
          about the same event. Running them together as plain paragraphs would
          leave a driver reading their own words back as if the office had said
          them.
        */
        <View style={styles.answer}>
          <Text style={styles.answerFrom}>
            The office replied{report.answered_at === null ? '' : ` · ${whenLabel(report.answered_at)}`}
          </Text>
          <Text style={styles.answerText}>{report.answer}</Text>
        </View>
      ) : (
        <Text style={styles.waitingNote}>
          Nobody has answered yet. You will get a notification when they do.
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topic: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  pillWaiting: {
    backgroundColor: colors.warningTint,
  },
  pillAnswered: {
    backgroundColor: colors.successTint,
  },
  pillText: {
    ...typography.captionStrong,
  },
  pillTextWaiting: {
    color: colors.warning,
  },
  pillTextAnswered: {
    color: colors.success,
  },
  when: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  /** The driver's own words. Shown in full — see the screen's docblock. */
  reportText: {
    ...typography.body,
    color: colors.text,
    marginTop: spacing.sm,
  },
  answer: {
    marginTop: spacing.md,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  answerFrom: {
    ...typography.captionStrong,
    color: colors.primaryText,
    marginBottom: spacing.xs,
  },
  answerText: {
    ...typography.body,
    color: colors.textBody,
  },
  waitingNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
