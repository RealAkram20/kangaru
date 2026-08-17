import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDutyToggle } from '../duty/useDutyToggle';
import { appVersion } from '../ui/version';
import { initials, tripsTotal } from '../profile/presentation';
import { useDriverProfile } from '../profile/queries';
import { useNotifications } from '../notifications/queries';
import { useDriverStats, useTrips } from '../trips/queries';
import { ratingValue } from '../trips/statsPresentation';
import { usePressScale } from '../ui/components';
import {
  BellIcon,
  CarIcon,
  ChartIcon,
  GaugeIcon,
  GiftIcon,
  HeadsetIcon,
  HouseIcon,
  PowerIcon,
  ReceiptIcon,
  RouteIcon,
  SettingsIcon,
  ShieldIcon,
  StarIcon,
  UserIcon,
  WalletIcon,
  XIcon,
} from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';
import { drawerSections, liveTripRow, selectedRowKey, type DrawerRow } from './drawer';

/**
 * The drawer — the whole map of the app, and the one menu in it.
 *
 * ## Why this replaced the Profile screen's list rather than joining it
 *
 * The owner's instruction was *"we don't need to repeat the menus"*.
 * `ProfileScreen` carried eight navigation rows and this drawer draws thirteen;
 * keeping both would have meant two lists that drift, and a driver who learned
 * the app from one finding rows missing from the other. `ProfileScreen` is now
 * the profile — who the driver is, their vehicle, their papers — and nothing
 * else.
 *
 * **The tab bar stays.** A drawer is two taps to anywhere; the four screens a
 * driver opens during a shift stay one tap, in a cradle, one-handed. This is
 * the one place the mockup was not followed literally: it draws no tab bar.
 *
 * ## What is not drawn, and why
 *
 * **No "Trip Details" row unless a trip is live.** A trip screen needs a trip
 * id, and a menu entry that opens whichever journey happened to be most recent
 * is a guess presented as navigation. See `liveTripRow`.
 *
 * **The version is read from the manifest**, never typed. The mockup says
 * v2.3.0 and this app is on 1.0.0 — a hardcoded version string is wrong the
 * first time anybody ships, and it is the number a driver reads out when they
 * ring the office about a bug.
 *
 * ## Motion
 *
 * None of its own. The slide and the scrim are the navigator's, which is one
 * of the reasons the owner chose a real drawer over a hand-built panel — that
 * animation runs on the UI thread through Reanimated and stays smooth while
 * the JS thread is busy. The rows use the app's shared `usePressScale`, which
 * is feedback rather than decoration.
 */
export function DrawerContent(props: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const { data: profile } = useDriverProfile();
  const { data: stats } = useDriverStats();
  const { data: trips } = useTrips();
  const { data: inbox } = useNotifications();

  // The shared hook, not a second copy of the toggle. `DutyBar` on the home
  // screen posts through the same one, so the two controls cannot disagree
  // about whether this driver is working — and the location permission prompt
  // is asked in one place rather than in whichever control they happened to
  // press first.
  const { onDuty, busy: dutyBusy, refusal, toggle } = useDutyToggle();

  // Read once per render so every row agrees about which trip is live.
  const sections = drawerSections(liveTripRow(trips?.trips), inbox?.unread ?? null);

  const [tab, screen] = currentRoute(props);
  const selected = selectedRowKey(sections, tab, screen);

  const go = (row: DrawerRow) => {
    props.navigation.closeDrawer();

    const { tab: target, screen: inner, params } = row.destination;

    // Nested navigation: the drawer sits above the tab navigator, so every
    // destination is a screen inside one of its four stacks. Every row names
    // its screen — `drawerSections` records the device-found bug behind that:
    // "resume the tab where it was" made the Profile row a no-op for anybody
    // already inside the Profile stack.
    if (inner === undefined) {
      props.navigation.navigate('Main', { screen: target });

      return;
    }

    props.navigation.navigate('Main', {
      screen: target,
      params: { screen: inner, params },
    });
  };

  return (
    <View style={[styles.drawer, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.head}>
        <Image
          source={require('../../assets/brand/wordmark.png')}
          style={styles.wordmark}
          contentFit="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="KangaruRide"
          transition={0}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          hitSlop={10}
          onPress={() => props.navigation.closeDrawer()}
          style={styles.close}
        >
          <XIcon size={22} color={colors.textBody} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/*
        One composed sentence for the identity block. A reader walking the
        pieces would otherwise announce the name, "4.8", "428 trips" and
        "Online" as four disconnected fragments (`docs/screen-rules.md` §6).

        Tappable, and it opens the Profile — the block *is* the driver, and a
        face that goes nowhere in a menu full of rows that go somewhere reads
        as broken. Same destination as the Profile row below; one more way in,
        not a second meaning.
      */}
      <Pressable
        style={styles.identity}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${profile?.name ?? 'Driver'}. Rating ${ratingValue(stats)}. ${tripsTotal(profile)}. ${onDuty ? 'Online' : 'Offline'}. Opens your profile.`}
        onPress={() =>
          go({
            key: 'profile',
            label: 'Profile',
            destination: { tab: 'Profile', screen: 'ProfileHome' },
          })
        }
      >
        <Avatar profile={profile} online={onDuty} />

        <View style={styles.identityText}>
          <Text style={styles.name} numberOfLines={1}>
            {profile?.name ?? '—'}
          </Text>

          <View style={styles.ratingRow}>
            <StarIcon size={16} />
            <Text style={styles.rating}>{ratingValue(stats)}</Text>
            <Text style={styles.tripCount} numberOfLines={1}>
              ({tripsTotal(profile)})
            </Text>
          </View>

          {/*
            The duty state carries a **word**, never the green dot alone —
            `docs/screen-rules.md` §6, and this is the single most consequential
            fact on the screen: a driver who believes they are online and is not
            is being offered no work and does not know it.
          */}
          <View style={[styles.dutyPill, onDuty ? styles.dutyPillOn : styles.dutyPillOff]}>
            <View style={[styles.dutyDot, onDuty ? styles.dutyDotOn : styles.dutyDotOff]} />
            <Text style={[styles.dutyLabel, onDuty ? styles.dutyLabelOn : styles.dutyLabelOff]}>
              {onDuty ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>
      </Pressable>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section, index) => (
          <View key={section.key}>
            {index > 0 && <View style={styles.rule} />}

            {section.rows.map((row) => (
              <DrawerItem
                key={row.key}
                row={row}
                selected={row.key === selected}
                onPress={() => go(row)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: insets.bottom + spacing.md }]}>
        <DutyButton online={onDuty} busy={dutyBusy} onPress={() => void toggle()} />

        {/* The server's own sentence — approved leave, a roster, a suspension.
            ADR-0017 put that wording in one place so a driver is not told two
            different things by two different screens, and this is the second
            screen. */}
        {refusal !== null && (
          <Text accessibilityRole="alert" style={styles.refusal}>
            {refusal}
          </Text>
        )}

        <Text style={styles.version}>{appVersion()}</Text>
      </View>
    </View>
  );
}

/**
 * The driver's photograph, or their initials.
 *
 * **Initials are the ordinary case, not a fallback for an error.** A driver
 * who has not sent the office a photograph has one of these, permanently, and
 * it must not look like something failed — which is why it is the brand tint
 * and their letters rather than a grey silhouette.
 */
function Avatar({
  profile,
  online,
}: {
  profile: { name: string; photo_url: string | null } | undefined;
  online: boolean;
}) {
  const photo = profile?.photo_url ?? null;

  return (
    <View style={styles.avatarWrap}>
      {photo === null ? (
        <View style={styles.avatarInitials}>
          <Text style={styles.avatarLetters}>{initials(profile?.name)}</Text>
        </View>
      ) : (
        <Image
          source={{ uri: photo }}
          style={styles.avatarPhoto}
          contentFit="cover"
          transition={120}
          // Decorative here: the name sits beside it and the block already
          // carries one composed announcement.
          accessibilityElementsHidden
        />
      )}

      {/* Paired with the pill's word below it, never carrying the state alone. */}
      <View style={[styles.avatarDot, online ? styles.dutyDotOn : styles.dutyDotOff]} />
    </View>
  );
}

function DrawerItem({
  row,
  selected,
  onPress,
}: {
  row: DrawerRow;
  selected: boolean;
  onPress: () => void;
}) {
  const press = usePressScale();
  const tint = selected ? colors.primary : colors.textBody;

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={
          row.badge !== null && row.badge !== undefined && row.badge > 0
            ? `${row.label}, ${row.badge} unread`
            : row.label
        }
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.item, selected && styles.itemSelected]}
      >
        <View style={styles.itemIcon}>{glyphFor(row.key, tint)}</View>

        <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]} numberOfLines={1}>
          {row.label}
        </Text>

        {/*
          A dot, not a number. The mockup draws one, and it is the right
          choice: the exact count of unread notices is not a figure anybody
          acts on differently at 3 than at 4, and a number invites the reader
          to reconcile it against the bell on Home — which counts something
          else entirely (job offers, with a fifteen-second clock).
        */}
        {row.badge !== null && row.badge !== undefined && row.badge > 0 && (
          <View style={styles.unread} />
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Going on and off duty, from the menu.
 *
 * The mockup's red **Go Offline**. Red is right for *going* offline — it is
 * the destructive direction, it stops work arriving — but the button has to
 * say both states, and going *on* duty is not destructive. So the tone follows
 * the action rather than the control.
 *
 * **This is the same mutation the home screen's toggle posts**, not a second
 * one: `useSetDuty` is shared, so the two controls cannot disagree about
 * whether a driver is working.
 */
function DutyButton({
  online,
  busy,
  onPress,
}: {
  online: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const press = usePressScale();
  const label = online ? 'Go Offline' : 'Go Online';
  const tone = online ? colors.danger : colors.primaryText;

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[
          styles.duty,
          { backgroundColor: online ? colors.dangerTint : colors.primaryTint, opacity: busy ? 0.5 : 1 },
        ]}
      >
        <PowerIcon size={20} color={tone} strokeWidth={2.2} />
        <Text style={[styles.dutyButtonLabel, { color: tone }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The glyph for a row, keyed on the row rather than passed with it.
 *
 * Icons are components and `drawer.ts` is a pure module a test can read
 * without a renderer — keeping JSX out of it is what lets the row list be
 * asserted as data. The live-trip row takes `RouteIcon`, which is the journey,
 * rather than a status glyph that would change under the driver.
 */
function glyphFor(key: string, color: string): ReactNode {
  const props = { color, size: 22, strokeWidth: 1.9 };

  switch (key) {
    case 'home':
      return <HouseIcon {...props} />;
    case 'live-trip':
      return <RouteIcon {...props} />;
    case 'trips-history':
      return <ReceiptIcon {...props} />;
    case 'earnings':
      return <ChartIcon {...props} />;
    case 'wallet':
      return <WalletIcon {...props} />;
    case 'promotions':
      return <GiftIcon {...props} />;
    case 'performance':
      return <GaugeIcon {...props} />;
    case 'notifications':
      return <BellIcon {...props} />;
    case 'profile':
      return <UserIcon {...props} />;
    case 'documents':
      return <CarIcon {...props} />;
    case 'settings':
      return <SettingsIcon {...props} />;
    case 'safety':
      return <ShieldIcon {...props} />;
    case 'support':
      return <HeadsetIcon {...props} />;
    default:
      return null;
  }
}

/**
 * Which tab and screen the driver is on, dug out of the navigator's state.
 *
 * Defensive at every level: `DrawerContentComponentProps` types `state` as a
 * navigation state, but the nested route may not have loaded its own state
 * yet on the very first render, and an optimistic `.routes[index].state.routes`
 * chain throws rather than degrading. Returning undefined simply draws no row
 * as selected, which is the honest answer while the answer is unknown.
 */
function currentRoute(props: DrawerContentComponentProps): [string | undefined, string | undefined] {
  const drawerRoute = props.state.routes[props.state.index];
  const tabState = drawerRoute?.state as
    | { index?: number; routes?: { name: string; state?: { index?: number; routes?: { name: string }[] } }[] }
    | undefined;

  const tabRoute = tabState?.routes?.[tabState.index ?? 0];
  const stackState = tabRoute?.state;
  const screenRoute = stackState?.routes?.[stackState.index ?? 0];

  return [tabRoute?.name, screenRoute?.name];
}

const styles = StyleSheet.create({
  drawer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  wordmark: {
    width: 168,
    height: 34,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  avatarWrap: {
    width: 64,
    height: 64,
  },
  avatarInitials: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetters: {
    ...typography.heading,
    color: colors.primaryText,
  },
  avatarPhoto: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  avatarDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  identityText: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  rating: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  tripCount: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
  dutyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  dutyPillOn: {
    backgroundColor: colors.primaryTint,
  },
  dutyPillOff: {
    backgroundColor: colors.surfaceSunken,
  },
  dutyDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  dutyDotOn: {
    backgroundColor: colors.primary,
  },
  dutyDotOff: {
    backgroundColor: colors.textMuted,
  },
  dutyLabel: {
    ...typography.captionStrong,
  },
  dutyLabelOn: {
    color: colors.primaryText,
  },
  dutyLabelOff: {
    color: colors.textMuted,
  },
  list: {
    paddingHorizontal: spacing.sm + 4,
    paddingBottom: spacing.md,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // The 52pt floor this app holds everywhere. A mis-tap in a menu is cheap,
    // but the rule is the rule and this is read one-handed in a cradle.
    minHeight: 52,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.md,
  },
  itemSelected: {
    backgroundColor: colors.primaryTint,
  },
  itemIcon: {
    width: 24,
    alignItems: 'center',
  },
  itemLabel: {
    ...typography.body,
    fontSize: 17,
    color: colors.textBody,
    flex: 1,
  },
  itemLabelSelected: {
    ...typography.bodyStrong,
    fontSize: 17,
    color: colors.primaryText,
  },
  unread: {
    width: 9,
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  foot: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  duty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
    minHeight: 52,
    borderRadius: radius.md,
  },
  dutyButtonLabel: {
    ...typography.button,
  },
  refusal: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
  },
  version: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
