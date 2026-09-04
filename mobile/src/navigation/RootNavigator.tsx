import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { OfferPresenter } from '../duty/OfferPresenter';
import { navigationRef } from './navigationRef';
import { useSheetTransition, useStackTransition } from './stackTransition';
import { registerNavigationForTracing } from '../tracing';
import { PresenceController } from '../duty/PresenceController';
import { FirstRunPermissions } from '../permissions/FirstRunPermissions';
import { PushRegistrar } from '../push/PushRegistrar';
import { PushRouter } from '../push/PushRouter';
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
import { MyReportsScreen } from '../screens/MyReportsScreen';
import { ReportIssueScreen } from '../screens/ReportIssueScreen';
import { PromotionsScreen } from '../screens/PromotionsScreen';
import { SafetyScreen } from '../screens/SafetyScreen';
import { SupportScreen } from '../screens/SupportScreen';
import { RideCompleteScreen } from '../screens/RideCompleteScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { KycVerificationScreen } from '../screens/KycVerificationScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { BankDetailsScreen } from '../screens/BankDetailsScreen';
import { CloseAccountScreen } from '../screens/CloseAccountScreen';
import { PermissionsScreen } from '../screens/PermissionsScreen';
import { SyncQueueScreen } from '../screens/SyncQueueScreen';
import { TimeOffScreen } from '../screens/TimeOffScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { AddDropoffScreen } from '../screens/AddDropoffScreen';
import { TripDetailScreen } from '../screens/TripDetailScreen';
import { TripInProgressScreen } from '../screens/TripInProgressScreen';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { TripMapScreen } from '../screens/TripMapScreen';
import { WaitingForPassengerScreen } from '../screens/WaitingForPassengerScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { HouseIcon, ReceiptIcon, UserIcon, WalletIcon } from '../ui/icons';
import { colors } from '../ui/theme';
import { ApplicantGate } from './ApplicantGate';
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
  const [screen, setScreen] = useState<'welcome' | 'signin' | 'signup' | 'kyc' | 'forgot'>(
    'welcome',
  );

  /**
   * The verified name and email a social sign-in handed back for a stranger
   * (ADR-0028 §3) — carried to the application form so the person types
   * their phone number and nothing they already proved.
   */
  const [prefill, setPrefill] = useState<{ name: string; email: string } | null>(null);

  /**
   * The claim ticket a submitted application returns (ADR-0048 §4), and the
   * number the confirmation says the office will ring.
   *
   * **Held in memory and nowhere else.** It is a live credential for somebody's
   * identity documents, valid for 24 hours, belonging to a person with no
   * account — so there is nothing to persist it *to* that would not be a worse
   * place than this. Losing it by backgrounding the app costs an applicant
   * their upload step and not their application, which is the right way round
   * for that trade.
   */
  const [ticket, setTicket] = useState<{ token: string; phone: string } | null>(null);

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
          onSubmitted={(token, phone) => {
            setTicket({ token, phone });
            setScreen('kyc');
          }}
          prefill={prefill}
        />
      );
    case 'kyc':
      // Guarded rather than asserted: `ticket` and `screen` are two pieces of
      // state and only the transition above sets both. A `kyc` screen with no
      // ticket cannot happen today, and must not render a broken screen if it
      // ever does.
      return ticket === null ? (
        <SignInScreen
          onSignUp={() => setScreen('signup')}
          onBack={() => setScreen('welcome')}
          onForgot={() => setScreen('forgot')}
        />
      ) : (
        <KycVerificationScreen
          uploadToken={ticket.token}
          phone={ticket.phone}
          onDone={() => {
            // Dropped on the way out. Nothing later in this session has any
            // business holding it.
            setTicket(null);
            setScreen('signin');
          }}
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
  // One decision for how every screen in the app arrives, made in
  // `stackTransition.ts` and spread into all four stacks — so the push feels
  // the same whichever tab a driver is in.
  const transition = useStackTransition();
  const sheet = useSheetTransition();

  return (
    <TripsStack.Navigator
      screenOptions={{
        ...transition,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        // With `enableFreeze(true)` in index.ts, a screen this stack has
        // navigated past stops rendering. This stack is the one that earns
        // it: Home keeps a map WebView at the bottom of the stack for a
        // whole trip, and TripInProgress ticks a clock every second — work
        // that was all still running behind the screen on display.
        freezeOnBlur: true,
      }}
    >
      {/* Home has its own top bar — brand, notifications, avatar — so the
          navigator's header would be a second one stacked above it. */}
      <TripsStack.Screen name="TripsHome" component={HomeScreen} options={{ headerShown: false }} />
      {/*
        No `Today` screen. It was a second copy of the home screen — the same
        duty bar, the same offers, the same trip list — reachable only by
        tapping the bell, which is a control that means "what has the office
        told me". The owner's *"make sure this page is removed"*; the bell now
        opens `Notifications`, and Home already answers what today has come to.

        Deleted rather than left registered and unreachable, exactly as
        `Settings` was below: an orphaned route is one `navigate('Today')` away
        from coming back to life with nothing pointing at it.
      */}
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
      {/* The next drop-off, searched and added mid-run (ADR-0045 §4). */}
      <TripsStack.Screen
        name="AddDropoff"
        component={AddDropoffScreen}
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
        //
        // **`headerShown: false` like every other screen in this app.** This
        // was the one route that kept React Navigation's stock header, so the
        // screen wore a system title bar reading "Odometer" while the content
        // below it said "Opening odometer" — the app's chrome nowhere, the
        // same word twice, and a back arrow that matched nothing else a driver
        // had seen. The owner's *"it looks nothing like our design"* was that.
        // `OdometerScreen` draws its own `ScreenHeader`.
        options={{ ...sheet, headerShown: false }}
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
  const transition = useStackTransition();

  return (
    <EarningsStack.Navigator screenOptions={{ ...transition, headerShown: false }}>
      <EarningsStack.Screen name="EarningsHome" component={EarningsScreen} />
    </EarningsStack.Navigator>
  );
}

/**
 * The Wallet tab. `Transactions` keeps its back arrow — unlike the tab root
 * above it, there genuinely is something behind it.
 */
function WalletNavigator() {
  const transition = useStackTransition();

  return (
    <WalletStack.Navigator screenOptions={{ ...transition, headerShown: false }}>
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
  const transition = useStackTransition();

  return (
    <ProfileStack.Navigator
      screenOptions={{
        ...transition,
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
      {/*
        Own header, like every screen around it. The navigator's default bar
        drew a back arrow this app draws nowhere else — a different glyph, a
        different weight, a different gutter — and on a stack where ten screens
        out of twelve use `ScreenHeader`, the odd one reads as a screen from
        another app rather than as a variation.
      */}
      <ProfileStack.Screen
        name="ChangePassword"
        component={PasswordScreen}
        options={{ headerShown: false }}
      />
      {/*
        ADR-0043. Registered now that the whole loop behind it is real — the
        request, the office queue that answers it, and the email that carries
        the answer back. The Profile row stayed off the screen until this was
        true, on `docs/screen-rules.md`'s refusal of dead surfaces: a Delete
        that only appears to work is worse than no Delete.
      */}
      <ProfileStack.Screen
        name="CloseAccount"
        component={CloseAccountScreen}
        options={{ headerShown: false }}
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
      {/*
        ADR-0046 / ADR-0049. Draws its own `ScreenHeader`, like every screen on
        this stack.
      */}
      <ProfileStack.Screen
        name="Permissions"
        component={PermissionsScreen}
        options={{ headerShown: false }}
      />
      {/* ADR-0042. Draws its own `ScreenHeader`, like every screen on this stack. */}
      <ProfileStack.Screen
        name="BankDetails"
        component={BankDetailsScreen}
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
      {/*
        ADR-0044, the two halves of issue reporting a driver can reach. Own
        headers, like every screen on this stack.

        Beside `Notifications` rather than on the Trips stack, because a report
        is about the driver's dealings with the office rather than about the
        work in front of them — and because the answer arrives as one of those
        notifications.
      */}
      <ProfileStack.Screen
        name="ReportIssue"
        component={ReportIssueScreen}
        options={{ headerShown: false }}
      />
      <ProfileStack.Screen
        name="MyReports"
        component={MyReportsScreen}
        options={{ headerShown: false }}
      />
      {/*
        No `Settings` screen. Its four rows are on `ProfileHome` now — the
        owner's *"all things in the settings should be moved to profile page,
        otherwise we are doing repetition"*, and then *"so we don't need the
        settings page"*. The route is deleted rather than left registered and
        unreachable: an orphaned screen is one `navigate('Settings')` away from
        coming back to life with no row pointing at it.
      */}
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
    /* `onReady` is Sentry's, and it is the only moment it can be done:
      the SDK reads `navigationRef.current` when it is handed the container,
      and that is null until this fires (ADR-0054 §4, `src/tracing.ts`). */
    <NavigationContainer
      ref={navigationRef}
      theme={theme}
      onReady={() => registerNavigationForTracing(navigationRef)}
    >
      {user === null ? (
        <AuthScreens />
      ) : (
        /*
          An account is not yet a driver (ADR-0057 §5). Since accounts are
          minted at application time, somebody can sign in while the office is
          still reading their papers — and the four controllers below all
          assume a driver profile that does not exist yet. `ApplicantGate`
          answers the one question that separates them and shows the waiting
          screen instead, rather than a home screen where every panel 404s.
        */
        <ApplicantGate>
          {/* All four render nothing, and all four are mounted here rather
            than on a screen for the same reason: a driver who switches tabs
            must not silently stop being tracked, stop being findable, or
            stop being reachable.

            `PushRouter` in particular has to be mounted before the driver
            can touch anything — a tap on a notification that launched the
            app from a killed process is waiting to be read at start-up, and
            nothing else in the app will ever ask for it. */}
          <GpsController />
          <PresenceController />
          <PushRegistrar />
          {/*
            ADR-0046. Asks for notifications, both location permissions and the
            camera in one sequence, once. Renders nothing, and sits beside
            `PushRegistrar` because both need a signed-in driver and neither
            belongs to a screen.
          */}
          <FirstRunPermissions />
          <PushRouter />
          <MainNavigator />

          {/* Last, and outside the navigator on purpose. A job has a
            countdown on it and has to appear over whatever the driver
            is doing — including a modal — so it is painted above the tabs
            rather than pushed into one of them. See `OfferPresenter`. */}
          <OfferPresenter />
        </ApplicantGate>
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
 * registering Notifications, Safety and Support as drawer screens — would have
 * taken the tab bar away from exactly those three and made them the odd screens
 * out in an app where every other pushed screen keeps it.
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

/**
 * The tab row's own height, before the system's navigation bar is added to it.
 *
 * React Navigation's Android default, stated here rather than inherited so the
 * arithmetic below is visible: the bar must be this tall *plus* whatever the
 * system takes at the bottom, or the two overlap and the labels lose their
 * descenders — *Earnings* and *Profile* are the two that show it first.
 */
const TAB_BAR_HEIGHT = 56;

function TabsNavigator() {
  /**
   * **The bottom inset is applied here, and leaving it to the navigator was
   * wrong on three-button Android.**
   *
   * The comment this replaces said the navigator adds the safe-area inset
   * itself — true under gesture navigation, where the inset is a few points and
   * nothing visibly collided. Reproduced on the emulator with
   * `com.android.internal.systemui.navbar.threebutton` enabled, which is what
   * the owner's handset uses: the system navigation bar draws **over** the
   * bottom of the tab bar and clips the descenders off *Earnings* and
   * *Profile*. The app is edge-to-edge, so the window extends under that bar
   * and something has to pay for it.
   *
   * `height` and `paddingBottom` move together deliberately: padding alone
   * shrinks the row into the same fixed height and pushes the labels up into
   * the icons, which is the failure the old comment was warning about. The
   * base is the navigator's own default rather than a number chosen by eye.
   */
  const insets = useSafeAreaInsets();

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
        },
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
        /*
          **Pressing Profile shows Profile.** Reported by the owner: *"now when
          I click on the profile it sends us to the notifications."*
          Reproduced on a handset.

          `Notifications` is a screen on *this* stack, but nothing reaches it
          from Profile — the bell in `HomeScreen`'s header does
          `getParent()?.navigate('Profile', { screen: 'Notifications' })`, and
          the drawer row lands in the same place. That is a push onto a tab the
          driver was never in, and React Navigation then does what it is
          supposed to: it remembers. So the tab kept restoring an inbox the
          driver opened from Home half an hour earlier, and the account they
          were actually reaching for was one Back press away with nothing
          saying so.

          Only this tab needs it, and that is the tell rather than an
          inconsistency: Profile is the only stack another tab pushes into.

          `preventDefault` is deliberately not used. The default press is what
          switches tab and what pops an already-open stack to its top, and
          suppressing it to navigate by hand loses both.
        */
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Profile', { screen: 'ProfileHome' });
          },
        })}
      />
    </Tabs.Navigator>
  );
}
