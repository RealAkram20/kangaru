import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { OfferPresenter } from '../duty/OfferPresenter';
import { PresenceController } from '../duty/PresenceController';
import { PushRegistrar } from '../push/PushRegistrar';
import { GpsController } from '../location/GpsController';
import { DrawerContent } from './DrawerContent';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { PasswordScreen } from '../screens/PasswordScreen';
import { PerformanceScreen } from '../screens/PerformanceScreen';
import { OdometerScreen } from '../screens/OdometerScreen';
import { PickupScreen } from '../screens/PickupScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { PromotionsScreen } from '../screens/PromotionsScreen';
import { SafetyScreen } from '../screens/SafetyScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SupportScreen } from '../screens/SupportScreen';
import { RideCompleteScreen } from '../screens/RideCompleteScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { SyncQueueScreen } from '../screens/SyncQueueScreen';
import { TimeOffScreen } from '../screens/TimeOffScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { TripDetailScreen } from '../screens/TripDetailScreen';
import { TripInProgressScreen } from '../screens/TripInProgressScreen';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { TripMapScreen } from '../screens/TripMapScreen';
import { WaitingForPassengerScreen } from '../screens/WaitingForPassengerScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { HouseIcon, ReceiptIcon, UserIcon, WalletIcon } from '../ui/icons';
import { colors } from '../ui/theme';
import { TripsHistoryScreen } from '../screens/TripsHistoryScreen';
import type {
  EarningsStackParams,
  RootDrawerParams,
  ProfileStackParams,
  RootTabParams,
  TripsStackParams,
  WalletStackParams,
} from './types';

const Drawer = createDrawerNavigator<RootDrawerParams>();
const Tabs = createBottomTabNavigator<RootTabParams>();
const TripsStack = createNativeStackNavigator<TripsStackParams>();
const EarningsStack = createNativeStackNavigator<EarningsStackParams>();
const WalletStack = createNativeStackNavigator<WalletStackParams>();
const ProfileStack = createNativeStackNavigator<ProfileStackParams>();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    primary: colors.primary,
    border: colors.border,
  },
};

/**
 * The signed-out half of the app: a front door and its two rooms.
 *
 * Plain state rather than a stack, because a stack would give this a back
 * gesture and there is nothing behind the welcome screen — a driver moving
 * between "let me in" and "sign me up" is switching a mode, not navigating
 * into something. React Navigation would also mount everything and animate
 * the swap, which on a cold start is an animation played at somebody who has
 * not asked for anything yet.
 */
function AuthScreens() {
  const [screen, setScreen] = useState<'welcome' | 'signin' | 'signup' | 'forgot'>('welcome');

  /**
   * The verified name and email a social sign-in handed back for a stranger
   * (ADR-0028 §3) — carried to the application form so the person types
   * their phone number and nothing they already proved.
   */
  const [prefill, setPrefill] = useState<{ name: string; email: string } | null>(null);

  // The hardware back button walks back to the front door rather than out of
  // the app. Plain state gets no back handling for free — without this,
  // Android's back gesture from the sign-up form exits the app entirely,
  // which reads as a crash to anybody mid-form.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen !== 'welcome') {
        setScreen('welcome');

        return true;
      }

      // On the front door itself, back means leave — the platform default.
      return false;
    });

    return () => sub.remove();
  }, [screen]);

  switch (screen) {
    case 'signin':
      return (
        <SignInScreen
          onSignUp={() => setScreen('signup')}
          onBack={() => setScreen('welcome')}
          onForgot={() => setScreen('forgot')}
        />
      );
    case 'signup':
      return (
        <SignUpScreen
          onSignIn={() => setScreen('signin')}
          onBack={() => setScreen('welcome')}
          prefill={prefill}
        />
      );
    case 'forgot':
      return <ForgotPasswordScreen onDone={() => setScreen('signin')} />;
    default:
      return (
        <WelcomeScreen
          onSignUp={() => {
            setPrefill(null);
            setScreen('signup');
          }}
          onSignIn={() => setScreen('signin')}
          onApply={(fields) => {
            setPrefill(fields);
            setScreen('signup');
          }}
        />
      );
  }
}

function TripsNavigator() {
  return (
    <TripsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      {/* Home has its own top bar — brand, notifications, avatar — so the
          navigator's header would be a second one stacked above it. */}
      <TripsStack.Screen name="TripsHome" component={HomeScreen} options={{ headerShown: false }} />
      <TripsStack.Screen name="Today" component={TodayScreen} options={{ title: "Today's work" }} />
      <TripsStack.Screen name="Pickup" component={PickupScreen} options={{ headerShown: false }} />
      {/* Own header, same as Pickup — the navigator's would stack a second
          title bar above the screen's own. */}
      <TripsStack.Screen
        name="WaitingForPassenger"
        component={WaitingForPassengerScreen}
        options={{ headerShown: false }}
      />
      {/* Own header, as Pickup and the waiting screen do. */}
      <TripsStack.Screen
        name="TripInProgress"
        component={TripInProgressScreen}
        options={{ headerShown: false }}
      />
      <TripsStack.Screen
        name="TripMap"
        component={TripMapScreen}
        options={{ headerShown: false }}
      />
      {/* Own header, like the live-leg screens — the navigator's would stack
          a second title bar above it. */}
      <TripsStack.Screen
        name="TripsHistory"
        component={TripsHistoryScreen}
        options={{ headerShown: false }}
      />
      {/*
        Its own header now, like every other renovated screen: the record grew a
        Help control, and the navigator's bar has nowhere to put one. Leaving
        `title: 'Trip'` here would stack two headers.
      */}
      <TripsStack.Screen
        name="TripDetail"
        component={TripDetailScreen}
        options={{ headerShown: false }}
      />
      {/* Own header, as the three live-leg screens do. `gestureEnabled` is
          off and there is no back arrow to the previous screen: behind this
          is the live-leg screen for a trip that has just ended, and swiping
          back to it offers an End trip button that 422s. Every exit goes
          Home. */}
      <TripsStack.Screen
        name="RideComplete"
        component={RideCompleteScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <TripsStack.Screen
        name="Odometer"
        component={OdometerScreen}
        // A modal, because a half-entered odometer reading is not a state
        // worth keeping: the form is completed or abandoned as a unit, and
        // backing out leaves the trip exactly as it was.
        options={{ presentation: 'modal', title: 'Odometer' }}
      />
    </TripsStack.Navigator>
  );
}

/**
 * The Earnings tab. A stack of one, so every tab has the same shape and the
 * next screen below it is a line rather than a restructure.
 *
 * `headerShown: false` because `EarningsScreen` draws its own `ScreenHeader`
 * — and that header now has **no back arrow**, because this is a tab root and
 * there is nothing behind it. `goBack()` on a stack root is a silent no-op, so
 * an arrow here would look live, be tapped, and do nothing.
 */
function EarningsNavigator() {
  return (
    <EarningsStack.Navigator screenOptions={{ headerShown: false }}>
      <EarningsStack.Screen name="EarningsHome" component={EarningsScreen} />
    </EarningsStack.Navigator>
  );
}

/**
 * The Wallet tab. `Transactions` keeps its back arrow — unlike the tab root
 * above it, there genuinely is something behind it.
 */
function WalletNavigator() {
  return (
    <WalletStack.Navigator screenOptions={{ headerShown: false }}>
      <WalletStack.Screen name="WalletHome" component={WalletScreen} />
      <WalletStack.Screen name="Transactions" component={TransactionsScreen} />
    </WalletStack.Navigator>
  );
}

/**
 * The Profile tab: the account, the password form, and — since the bar went to
 * four — time off.
 *
 * Time off is the slot the fourth tab cost, and it is the right one to have
 * spent: a driver requests leave occasionally and checks their money daily.
 * It keeps a pushed screen with a real header, so nothing about it got harder
 * than one extra tap.
 */
function ProfileNavigator() {
  return (
    <ProfileStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      {/* Own header, like the tab roots beside it — the navigator's would
          stack a second title bar above the screen's own. */}
      <ProfileStack.Screen
        name="ProfileHome"
        component={ProfileScreen}
        options={{ headerShown: false }}
      />
      <ProfileStack.Screen
        name="TimeOff"
        component={TimeOffScreen}
        options={{ title: 'Time off' }}
      />
      <ProfileStack.Screen
        name="ChangePassword"
        component={PasswordScreen}
        options={{ title: 'Change password' }}
      />
      {/* ADR-0033. Both draw their own `ScreenHeader`, as `ProfileHome` does. */}
      <ProfileStack.Screen
        name="Documents"
        component={DocumentsScreen}
        options={{ headerShown: false }}
      />
      <ProfileStack.Screen
        name="SyncQueue"
        component={SyncQueueScreen}
        options={{ headerShown: false }}
      />
      {/* ADR-0038. Draws its own `ScreenHeader`, as the two above do. */}
      <ProfileStack.Screen
        name="Performance"
        component={PerformanceScreen}
        options={{ headerShown: false }}
      />
      {/* ADR-0036 and ADR-0037. Own header, like every screen on this stack. */}
      <ProfileStack.Screen
        name="Promotions"
        component={PromotionsScreen}
        options={{ headerShown: false }}
      />
      {/*
        The four the drawer added. On this stack rather than as drawer screens
        of their own, so they keep the tab bar like every other pushed screen —
        registering them on the drawer would have made exactly these four the
        odd ones out. All draw their own `ScreenHeader`.
      */}
      <ProfileStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ headerShown: false }}
      />
      <ProfileStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ headerShown: false }}
      />
      <ProfileStack.Screen
        name="Safety"
        component={SafetyScreen}
        options={{ headerShown: false }}
      />
      <ProfileStack.Screen
        name="Support"
        component={SupportScreen}
        options={{ headerShown: false }}
      />
    </ProfileStack.Navigator>
  );
}

export function RootNavigator() {
  const { ready, user } = useAuth();

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={theme}>
      {user === null ? (
        <AuthScreens />
      ) : (
        <>
        {/* Both render nothing, and both are mounted here rather than on a
            screen for the same reason: a driver who switches tabs must not
            silently stop being tracked or stop being findable. */}
        <GpsController />
        <PresenceController />
        <PushRegistrar />
        <MainNavigator />

        {/* Last, and outside the navigator on purpose. A job has a
            fifteen-second clock and has to appear over whatever the driver
            is doing — including a modal — so it is painted above the tabs
            rather than pushed into one of them. See `OfferPresenter`. */}
        <OfferPresenter />
        </>
      )}
    </NavigationContainer>
  );
}

/**
 * The drawer, wrapping the tab navigator.
 *
 * **One drawer screen, not five.** Every destination the drawer lists lives
 * inside one of the four tab stacks, so the drawer holds `Main` and nothing
 * else and its content component navigates into the nesting. The alternative —
 * registering Notifications, Settings, Safety and Support as drawer screens —
 * would have taken the tab bar away from exactly those four and made them the
 * odd screens out in an app where every other pushed screen keeps it.
 *
 * `drawerType: 'front'` is the mockup's: the panel slides over the home screen
 * and dims it, rather than pushing it sideways. `swipeEdgeWidth` is generous
 * because this is opened one-handed with a thumb, in a cradle.
 */
function MainNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { backgroundColor: colors.surface, width: '86%' },
        // Navy at low alpha, the app's own scrim token — the screen behind
        // reads as dimmed rather than switched off.
        overlayColor: colors.scrim,
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen name="Main" component={TabsNavigator} />
    </Drawer.Navigator>
  );
}

function TabsNavigator() {
  return (
        <Tabs.Navigator
          screenOptions={{
            headerShown: false,
            // No explicit height or bottom padding: the navigator adds the
            // safe-area inset itself, and overriding the height made the
            // labels sit underneath Android's gesture bar.
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
            tabBarItemStyle: { paddingVertical: 4 },
          }}
        >
          {/*
            Icons, where this bar deliberately had none.

            The old comment argued that "three tabs with one-word names do not
            need pictures, and a wrong picture is worse than none" — and the
            worry behind it was real but specific: it was about **icon fonts**,
            where a missing glyph renders as a tofu box. These are vectors from
            `ui/icons.tsx`, drawn on Lucide's geometry, and a vector cannot miss
            — the worst it can do is draw nothing.

            With four tabs the labels also got shorter and closer together, and
            a glyph is what makes a bar scannable at a glance from a cradle
            rather than read word by word.

            **None of them animates**, per DESIGN.md § Icons: navigation chrome
            stays static in both apps, and these are the icons a driver sees
            more often than any others in the product.
          */}
          <Tabs.Screen
            name="Home"
            component={TripsNavigator}
            options={{
              title: 'Home',
              tabBarIcon: ({ color }) => <HouseIcon color={color} size={24} strokeWidth={2} />,
            }}
          />
          <Tabs.Screen
            name="Earnings"
            component={EarningsNavigator}
            options={{
              title: 'Earnings',
              tabBarIcon: ({ color }) => <ReceiptIcon color={color} size={24} strokeWidth={2} />,
            }}
          />
          <Tabs.Screen
            name="Wallet"
            component={WalletNavigator}
            options={{
              title: 'Wallet',
              tabBarIcon: ({ color }) => <WalletIcon color={color} size={24} strokeWidth={2} />,
            }}
          />
          <Tabs.Screen
            name="Profile"
            component={ProfileNavigator}
            options={{
              title: 'Profile',
              tabBarIcon: ({ color }) => <UserIcon color={color} size={24} strokeWidth={2} />,
            }}
          />
        </Tabs.Navigator>
  );
}
