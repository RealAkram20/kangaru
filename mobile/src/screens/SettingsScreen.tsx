import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import type { ProfileStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import { Card, MenuRow, Screen, ScreenHeader, usePressScale } from '../ui/components';
import {
  AlertTriangleIcon,
  CalendarIcon,
  LockIcon,
  LogOutIcon,
  WalletIcon,
} from '../ui/icons';
import { appVersion } from '../ui/version';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Settings'>;

/**
 * The account's own controls — what this app does, not what the platform does.
 *
 * ## Where these rows came from
 *
 * `ProfileScreen` shed its menu when the drawer became the one map of the app
 * (the owner's *"we don't need to repeat the menus"*). The rows that are
 * **places** went to the drawer; the ones that are **acts on this account**
 * came here. Nothing was deleted.
 *
 * ## The layout, after the owner read the first version on a device
 *
 * Two sections with names, and **Log out pinned to the bottom of the screen**
 * rather than stacked under the list. The pin is the owner's call and it is
 * also the platform convention this screen was ignoring: the drawer pins Go
 * Offline the same way, and both are the "leave" action of their surface —
 * the one control that should sit apart from the things a driver does daily,
 * at arm's reach but never mid-list where a scroll-tap lands on it.
 *
 * ## What is deliberately not here
 *
 * **No push-notification toggle.** The only push this platform sends is a job
 * offer with a fifteen-second clock; a driver who switched it off would
 * silently stop being offered work while still looking available to dispatch.
 * The OS permission is the honest control, because turning it off there says
 * what it costs.
 *
 * **No language, units or theme.** None exists. A picker with one entry is a
 * promise. DESIGN.md §2 makes dark mode a later, optional theme, and this app
 * is deliberately light — a white panel is what fights Kampala sun.
 */
export function SettingsScreen({ navigation }: Props) {
  const { signOut } = useAuth();
  const { parked } = useSync();
  const insets = useSafeAreaInsets();

  const confirmSignOut = () => {
    Alert.alert('Log out?', 'You will need your email and password to sign back in.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen>
      <ScreenHeader title="Settings" subtitle={null} onBack={() => navigation.goBack()} />

      {/*
        `flexGrow: 1` + the spacer View is what pins the footer: on a tall
        screen Log out sits at the bottom edge, and on a small one it simply
        follows the content — pinning must never cost scrollability.
      */}
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>Work</Text>

        <Card style={styles.group}>
          <MenuRow
            icon={<CalendarIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Time off"
            announcement="Time off. Ask the office for leave."
            onPress={() => navigation.navigate('TimeOff')}
          />

          <View style={styles.separator} />

          {/*
            Settling up is a request the office answers (ADR-0032), not a
            transfer, and it lives on the Wallet tab — so this points there
            rather than implying a payment rail that does not exist.
          */}
          <MenuRow
            icon={<WalletIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Settling up"
            value="Wallet"
            announcement="Settling up. Opens the wallet, where you ask the office to settle."
            onPress={() => navigation.getParent()?.navigate('Wallet')}
          />
        </Card>

        <Text style={styles.sectionTitle}>Account</Text>

        <Card style={styles.group}>
          <MenuRow
            icon={<LockIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Change password"
            onPress={() => navigation.navigate('ChangePassword')}
          />

          <View style={styles.separator} />

          {/*
            The parked queue, and the sync state around it. Always here rather
            than only when something is stuck: a driver who has never seen this
            row cannot go looking for it on the day their closing odometer is
            refused (ADR-0023 §6).
          */}
          <MenuRow
            icon={
              <AlertTriangleIcon
                color={parked.length > 0 ? colors.danger : colors.primary}
                size={22}
                strokeWidth={2}
              />
            }
            label="Updates & sync"
            value={
              parked.length > 0
                ? `${parked.length} ${parked.length === 1 ? 'needs' : 'need'} you`
                : 'Nothing stuck'
            }
            tone={parked.length > 0 ? 'danger' : 'muted'}
            announcement={
              parked.length > 0
                ? `Updates and sync. ${parked.length} ${parked.length === 1 ? 'update needs' : 'updates need'} your attention.`
                : 'Updates and sync. Nothing is stuck.'
            }
            onPress={() => navigation.navigate('SyncQueue')}
          />
        </Card>

        {/* The spacer that pushes the footer to the bottom edge. */}
        <View style={styles.spacer} />

        <LogOutButton onPress={confirmSignOut} />

        <Text style={styles.version}>KangaruRide {appVersion()}</Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * Log out, drawn like the drawer's Go Offline — a full-width tinted pill with
 * the glyph, not a list row. The two are the same *kind* of act (leaving), and
 * a driver who has learned one should recognise the other.
 *
 * The confirmation dialog stays: a one-tap log out at the bottom of a scroll
 * is exactly where a flicked thumb lands.
 */
function LogOutButton({ onPress }: { onPress: () => void }) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log out"
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.logout}
      >
        <LogOutIcon size={20} color={colors.danger} strokeWidth={2.2} />
        <Text style={styles.logoutLabel}>Log out</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: {
    flexGrow: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginLeft: spacing.xs,
  },
  group: {
    // The rows carry their own height; the card is a container, not a row,
    // and double padding was what made the first version read as dated.
    paddingVertical: spacing.xs,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  spacer: {
    flexGrow: 1,
    minHeight: spacing.lg,
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.dangerTint,
  },
  logoutLabel: {
    ...typography.button,
    color: colors.danger,
  },
  version: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
