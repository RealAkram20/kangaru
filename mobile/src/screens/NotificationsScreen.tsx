import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DriverNotification } from '../api/endpoints';
import type { ProfileStackParams } from '../navigation/types';
import type { NotificationGlyph, NotificationTone } from '../notifications/presentation';
import { notificationLook, whenLabel } from '../notifications/presentation';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../notifications/queries';
import { Empty, Notice, Screen, ScreenHeader, usePressScale } from '../ui/components';
import {
  BellIcon,
  CarIcon,
  CheckCircleIcon,
  CircleXIcon,
  FileTextIcon,
  PackageIcon,
} from '../ui/icons';
import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Notifications'>;

/**
 * The glyph for each kind of message.
 *
 * A `Record` rather than a `switch`, so **`tsc` refuses a glyph nobody drew**:
 * adding a case to `NotificationGlyph` without adding it here is a compile
 * error rather than a blank space on a shipped handset.
 */
const GLYPHS: Record<NotificationGlyph, (props: { color: string }) => ReactNode> = {
  job: (props) => <CarIcon size={26} strokeWidth={1.9} {...props} />,
  approved: (props) => <CheckCircleIcon size={26} strokeWidth={1.9} {...props} />,
  rejected: (props) => <CircleXIcon size={26} strokeWidth={1.9} {...props} />,
  export: (props) => <FileTextIcon size={26} strokeWidth={1.9} {...props} />,
  order: (props) => <PackageIcon size={26} strokeWidth={1.9} {...props} />,
  other: (props) => <BellIcon size={26} strokeWidth={1.9} {...props} />,
};

/**
 * The colour each tone is drawn in — tokens only, DESIGN.md §8.
 *
 * `primaryText` rather than `primary` for the brand tone: `#01903D` measures
 * ~4.1:1 on white and DESIGN.md §1 restricts it to large or bold accents, and
 * a 26pt glyph is neither.
 */
const TONES: Record<NotificationTone, string> = {
  brand: colors.primaryText,
  good: colors.success,
  danger: colors.danger,
  info: colors.info,
  neutral: colors.textMuted,
};

/**
 * What the office has told this driver (ADR-0039).
 *
 * ## This inbox already existed
 *
 * `Modules/Notifications` has served it since ADR-0007, `trip.offered` has
 * been one of its types all along, and the driver token was already allowed to
 * reach `notifications.index`, `.read` and `.read-all`. The app simply never
 * had a screen. Nothing on the server was added for this — no new endpoint, no
 * new table, no contract change.
 *
 * ## Why this is not the bell on the home screen
 *
 * The bell counts **job offers**, and its comment says so: an offer has a
 * fifteen-second clock and is *"the only thing here worth interrupting for"*.
 * These are records — a booking decision, an export, a message from the
 * office — and they keep. Two badges that meant the same thing would make both
 * of them mean nothing, so the bell keeps its count and this keeps its dot.
 *
 * ## Why the list is thinner than the mockup
 *
 * The mockup drew five kinds of message — a bonus, an earnings summary, a
 * document expiring, a promotion, an app update — and **this platform sends
 * none of them**. `NotificationType` has five cases and only `trip.offered` is
 * ever addressed to a driver. ADR-0039 records what was refused and what would
 * have to be built to make each row real; `docs/screen-rules.md` §1 is why
 * none of them is faked here.
 *
 * ## What a row does not do
 *
 * **It does not follow `url`.** Those paths were written for the staff console
 * — "/bookings/12" means nothing in this app — and a row that navigated
 * nowhere would be worse than one that plainly does not navigate. Tapping
 * marks it read, which is the honest whole of what this screen can do with it.
 */
export function NotificationsScreen({ navigation }: Props) {
  const { data, isLoading, isError, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const markAllPress = usePressScale();
  const insets = useSafeAreaInsets();

  const notifications = data?.notifications ?? [];

  // Derived from the list in hand rather than from `meta.unread`, which is
  // nullable: an unloaded count and a count of zero must not look the same,
  // and a button that clears nothing is worse than no button.
  const hasUnread = notifications.some((notification) => !notification.is_read);

  return (
    <Screen>
      <ScreenHeader title="Notifications" subtitle={null} onBack={() => navigation.goBack()} />

      <ScrollView
        // Queried by the test that proves the "Pull down" copy is honest —
        // `PerformanceScreen` shipped that exact broken promise once already.
        testID="notifications-scroll"
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          // The error below tells a driver to pull down. It was saying that
          // over a list that could not be pulled.
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {isLoading && <ActivityIndicator color={colors.primary} style={styles.loading} />}

        {isError && (
          <Notice
            tone="warning"
            message="Could not load your notifications. Pull down once you have a signal."
          />
        )}

        {!isLoading && !isError && notifications.length === 0 && (
          <Empty message="Nothing from the office yet. Job offers arrive on the home screen, not here." />
        )}

        {notifications.map((notification) => (
          <Row
            key={notification.id}
            notification={notification}
            onPress={() => {
              if (!notification.is_read) {
                // Fire and forget. A read receipt is not work, and a toast
                // about one failing is noise about something nobody asked
                // for — see `useMarkNotificationRead`.
                markRead.mutate(notification.id);
              }
            }}
          />
        ))}
      </ScrollView>

      {hasUnread && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          {/*
            The same press scale every other tappable thing in this app uses,
            `MenuRow` included — a full-width row is exactly the case it was
            written for. A bare `Pressable` here would be the one control in
            the app that does not answer the thumb.
          */}
          <Animated.View style={{ transform: [{ scale: markAllPress.scale }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: markAll.isPending }}
              accessibilityLabel="Mark all as read"
              disabled={markAll.isPending}
              onPress={() => markAll.mutate()}
              onPressIn={markAllPress.onPressIn}
              onPressOut={markAllPress.onPressOut}
              style={styles.markAll}
            >
              {markAll.isPending ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.markAllLabel}>Mark all as read</Text>
              )}
            </Pressable>
          </Animated.View>

          {markAll.isError && (
            <Text style={styles.markAllError}>
              That did not reach the office. Try again once you have a signal.
            </Text>
          )}
        </View>
      )}
    </Screen>
  );
}

/**
 * One message: a glyph for what kind it is, the subject, the body, when it
 * arrived, and a dot if it has not been read.
 *
 * ## Unread is a dot *and* a heavier subject, never the tint alone
 *
 * `docs/screen-rules.md` §6, and it matters here because the whole list is
 * text: a driver in direct sun separating read from unread by a background
 * tint would be separating nothing.
 *
 * ## The colour of the glyph is not the only thing saying what this is
 *
 * The tone tints the glyph, and the glyph is a *different shape* per kind —
 * DESIGN.md §3's rule is that status is never carried by colour alone, and the
 * shape is what carries it for anyone who cannot separate the hues. The
 * screen-reader sentence names the kind in words as well.
 */
function Row({
  notification,
  onPress,
}: {
  notification: DriverNotification;
  onPress: () => void;
}) {
  const press = usePressScale();
  const unread = !notification.is_read;
  const look = notificationLook(notification.type);

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: unread }}
        // One composed sentence. The pieces would otherwise read as five
        // fragments, and "unread" is the one that decides whether a driver
        // bothers with the rest. `type_label` is here rather than on screen:
        // it says "New job" beside a subject that already reads "New job —
        // 3.2 km away", which is a repeat to the eye and a clarification to
        // somebody who cannot see the glyph.
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${notification.type_label}. ${notification.subject}. ${notification.body} ${whenLabel(notification.created_at)}`}
        // Only where there is one. Tapping an unread row does something
        // invisible — the dot goes and nothing else changes — and a row that
        // is already read does nothing at all, so promising an action there
        // would be the same lie in the other direction.
        accessibilityHint={unread ? 'Marks this message as read' : undefined}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.row}
      >
        <View style={styles.glyph}>{GLYPHS[look.glyph]({ color: TONES[look.tone] })}</View>

        <View style={styles.rowText}>
          <Text style={[styles.subject, unread && styles.subjectUnread]}>
            {notification.subject}
          </Text>

          <Text style={styles.bodyText}>{notification.body}</Text>

          <Text style={styles.when}>{whenLabel(notification.created_at)}</Text>
        </View>

        {/*
          A `testID` because there is no other handle on it: the dot carries
          no text and is deliberately outside the accessibility tree — the
          row's own sentence already opens with "Unread", and a second
          announcement for the same fact is how a list becomes unlistenable.
          The test that counts these is what stops the mark quietly vanishing.
        */}
        {unread && <View testID="unread-dot" style={styles.dot} />}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm + 4,
  },
  loading: {
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  glyph: {
    // A fixed column so subjects line up down the list however wide the glyph
    // draws. Top-aligned to the subject rather than centred on the card: a
    // two-line body would otherwise drag the icon away from the line it
    // belongs to.
    width: 28,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  subject: {
    ...typography.body,
    color: colors.textBody,
  },
  subjectUnread: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  bodyText: {
    ...typography.caption,
    color: colors.textBody,
  },
  when: {
    ...typography.caption,
    color: colors.textMuted,
  },
  footer: {
    // Pinned rather than scrolled to, like the mockup: the whole point of the
    // control is to be reachable without reading to the end of the list it
    // clears.
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  markAll: {
    minHeight: MIN_TOUCH_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markAllLabel: {
    ...typography.button,
    color: colors.primaryText,
  },
  markAllError: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    paddingBottom: spacing.sm,
  },
});
