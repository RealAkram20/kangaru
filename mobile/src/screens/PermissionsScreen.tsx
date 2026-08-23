import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import type { ProfileStackParams } from '../navigation/types';
import {
  openBatteryOptimisationSettings,
  openLocationSettings,
} from '../permissions/androidSettings';
import {
  statusLabel,
  statusTone,
  whatIsWrong,
  type PermissionKey,
  type PermissionStates,
  type Reliability,
} from '../permissions/permissions';
import { readPermissionStates, readReliability } from '../permissions/readState';
import { loadNotifications } from '../push/expoNotifications';
import { openFullScreenIntentSettings } from '../push/fullScreenIntent';
import { MenuRow, Notice, Screen, ScreenHeader } from '../ui/components';
import {
  BatteryChargingIcon,
  BellIcon,
  CameraIcon,
  MapPinIcon,
  NavigationIcon,
  SmartphoneIcon,
} from '../ui/icons';
import { colors, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Permissions'>;

/**
 * Everything this phone has to allow before a job can reach it.
 *
 * ## Why this screen exists
 *
 * The permissions that carry a job offer fail **silently and separately**. A
 * driver who declined notifications, or never granted "all the time", or whose
 * battery manager is throttling the online service, sees an app that looks
 * perfectly healthy and simply gets less work. Nothing on any other screen says
 * which of the six is the problem, and three of them cannot be fixed from
 * inside the app at all — Android insists the person does it themselves.
 *
 * So this is one place that names all six in a driver's own words, says which
 * are stopping work, and opens the right settings page for each.
 *
 * ## The rule it is built around, and the one thing it must never do
 *
 * **Two of the six cannot be read, and this screen does not pretend
 * otherwise.** `permissions.ts` argues it at length and
 * `fullScreenIntent.ts` argued it first: a "Not allowed" label that cannot be
 * verified would be wrong on every handset that had already granted it. Those
 * rows carry an action and no status word, and they are never counted in the
 * summary at the top — a driver whose phone is perfectly set up must not be
 * told that two things are broken every time they open this.
 *
 * ## Why it re-reads on focus
 *
 * Three of these rows leave the app entirely. A driver comes back from
 * Android's own settings having changed something, and a screen still showing
 * the state they left with is the single most likely way this lies to them.
 * `AppState` is the trigger rather than a navigation focus event, because the
 * return is from another *app*, not another screen.
 */
export function PermissionsScreen({ navigation }: Props) {
  const [states, setStates] = useState<PermissionStates | null>(null);
  const [live, setLive] = useState<Reliability | null>(null);

  const refresh = useCallback(() => {
    void readPermissionStates().then(setStates);
    // Read on the same schedule as the permissions: a driver flips Battery
    // Saver from the same shade they reach everything else from, so it can
    // change while this screen is open and behind it.
    void readReliability().then(setLive);
  }, []);

  useEffect(() => {
    refresh();

    // The return from Android's settings, which is an app switch and not a
    // navigation event — `useFocusEffect` would not fire for it.
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        refresh();
      }
    });

    return () => subscription.remove();
  }, [refresh]);

  /**
   * Ask, then fall back to settings.
   *
   * **Android only prompts once.** After a driver has refused,
   * `requestPermissionsAsync` resolves denied without showing anything — so a
   * row that only ever called it would do nothing at all, forever, for exactly
   * the drivers who need it. Asking first is right for the common case; opening
   * settings when the ask changes nothing is what makes the row honest.
   */
  const askThen = useCallback(
    async (ask: () => Promise<boolean>, fallback: () => Promise<unknown>) => {
      let granted = false;

      try {
        granted = await ask();
      } catch {
        granted = false;
      }

      if (!granted) {
        await fallback();
      }

      refresh();
    },
    [refresh],
  );

  /**
   * Opens an Android settings page, and says so when it cannot.
   *
   * **A row that is tapped and does nothing is worse than no row.** Both
   * Android-only rows below target `package:ug.co.kangaruride.driver`, which
   * does not exist when the app is running inside Expo Go — so the intent finds
   * nothing, and until this the failure was swallowed by a `catch`. It was
   * reported exactly that way: *"on click they did nothing"*.
   *
   * The message names the runtime rather than apologising, because the driver
   * reading it in the field is on a real build and will never see it — the only
   * person who can is somebody testing in Expo Go, and what they need to know
   * is which build to use.
   */
  const openOrExplain = useCallback(async (open: () => Promise<boolean>) => {
    if (await open()) {
      return;
    }

    Alert.alert(
      'Not available here',
      'This setting can only be opened from the installed KangaruRide app, not from Expo Go.',
    );
  }, []);

  // **One sentence, not a list of warnings.** `whatIsWrong` orders them by how
  // completely each stops work, so a driver fixes what is actually costing them
  // rather than reading three banners first.
  //
  // Null until the first read resolves, which is a beat rather than a spinner:
  // the reads are local and finish in milliseconds, and a spinner that flashes
  // for one frame is worse than a heading that is simply correct when it lands.
  const problem = states === null || live === null ? null : whatIsWrong(states, live);

  // Battery Saver is readable where the exemption is not, so the row carries it
  // rather than staying a bare action. Null keeps the row silent when the
  // switch is off or unknown — never a claim about the exemption itself.
  const batteryValue = live?.batterySaver === 'on' ? 'Battery saver is on' : null;

  const rowFor = (key: PermissionKey) => ({
    value: states === null ? null : statusLabel(states[key]),
    tone: states === null ? ('muted' as const) : statusTone(states[key]),
  });

  return (
    <Screen>
      <ScreenHeader
        title="Permissions"
        subtitle="What this phone must allow"
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {problem !== null ? <Notice message={problem} tone="warning" /> : null}

        <Text style={styles.sectionTitle}>So jobs reach you</Text>

        <MenuRow
          icon={<BellIcon color={colors.primary} size={22} strokeWidth={2} />}
          label="Notifications"
          announcement={`Notifications. ${rowFor('notifications').value ?? ''}.`}
          {...rowFor('notifications')}
          onPress={() =>
            void askThen(async () => {
              const Notifications = await loadNotifications();

              if (Notifications === null) {
                return false;
              }

              const { granted } = await Notifications.requestPermissionsAsync();

              return granted;
            }, openLocationSettings)
          }
        />

        <MenuRow
          icon={<MapPinIcon color={colors.primary} size={22} strokeWidth={2} />}
          label="Location"
          announcement={`Location. ${rowFor('locationWhenInUse').value ?? ''}.`}
          {...rowFor('locationWhenInUse')}
          onPress={() =>
            void askThen(async () => {
              const { granted } = await Location.requestForegroundPermissionsAsync();

              return granted;
            }, openLocationSettings)
          }
        />

        <MenuRow
          icon={<NavigationIcon color={colors.primary} size={22} strokeWidth={2} />}
          label="Location all the time"
          announcement={`Location all the time. ${rowFor('locationAlways').value ?? ''}.`}
          {...rowFor('locationAlways')}
          onPress={() =>
            void askThen(async () => {
              const { granted } = await Location.requestBackgroundPermissionsAsync();

              return granted;
            }, openLocationSettings)
          }
        />

        {/*
          Android only. iOS has no battery-optimisation concept and no
          full-screen intent at any privilege level, so both rows would be
          instructions a driver cannot carry out — the dead surface
          `docs/screen-rules.md` refuses.
        */}
        {Platform.OS === 'android' ? (
          <>
            <MenuRow
              icon={<BatteryChargingIcon color={colors.primary} size={22} strokeWidth={2} />}
              label="Run in the background"
              announcement={`Run in the background. ${batteryValue ?? 'Opens Android settings'}.`}
              /*
                The one row whose permission is unreadable but whose *effect*
                is not. Battery Saver is a different mechanism and it is
                readable, so when it is on this row stops being a bare action
                and says the thing that is actually stopping work.
              */
              value={batteryValue}
              tone={batteryValue === null ? 'muted' : 'warning'}
              onPress={() => void openOrExplain(openBatteryOptimisationSettings)}
            />

            <MenuRow
              icon={<SmartphoneIcon color={colors.primary} size={22} strokeWidth={2} />}
              label="Show jobs over the lock screen"
              announcement="Show jobs over the lock screen. Opens Android settings."
              {...rowFor('lockScreen')}
              onPress={() => void openOrExplain(openFullScreenIntentSettings)}
            />
          </>
        ) : null}

        <Text style={styles.sectionTitle}>For your trips</Text>

        <MenuRow
          icon={<CameraIcon color={colors.primary} size={22} strokeWidth={2} />}
          label="Camera"
          subtitle="Odometer photos only."
          announcement={`Camera. ${rowFor('camera').value ?? ''}.`}
          {...rowFor('camera')}
          onPress={() =>
            void askThen(async () => {
              const { granted } = await ImagePicker.requestCameraPermissionsAsync();

              return granted;
            }, openLocationSettings)
          }
        />

        {/* Said once, at the foot, rather than on every row that cannot report itself. */}
        <Text style={styles.footnote}>Android will not report the last two. Open each to check.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
    marginTop: spacing.md,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
});
