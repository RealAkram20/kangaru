import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { OfferPresenter } from '../duty/OfferPresenter';
import { PresenceController } from '../duty/PresenceController';
import { PushRegistrar } from '../push/PushRegistrar';
import { GpsController } from '../location/GpsController';
import { AccountScreen } from '../screens/AccountScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { PasswordScreen } from '../screens/PasswordScreen';
import { OdometerScreen } from '../screens/OdometerScreen';
import { PickupScreen } from '../screens/PickupScreen';
import { RideCompleteScreen } from '../screens/RideCompleteScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { TimeOffScreen } from '../screens/TimeOffScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { TripDetailScreen } from '../screens/TripDetailScreen';
import { TripInProgressScreen } from '../screens/TripInProgressScreen';
import { TripMapScreen } from '../screens/TripMapScreen';
import { WaitingForPassengerScreen } from '../screens/WaitingForPassengerScreen';
import { colors } from '../ui/theme';
import type { AccountStackParams, RootTabParams, TripsStackParams } from './types';

const Tabs = createBottomTabNavigator<RootTabParams>();
const TripsStack = createNativeStackNavigator<TripsStackParams>();
const AccountStack = createNativeStackNavigator<AccountStackParams>();

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
      <TripsStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
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
      <TripsStack.Screen name="TripDetail" component={TripDetailScreen} options={{ title: 'Trip' }} />
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

function AccountNavigator() {
  return (
    <AccountStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <AccountStack.Screen
        name="AccountHome"
        component={AccountScreen}
        options={{ title: 'Account' }}
      />
      <AccountStack.Screen
        name="ChangePassword"
        component={PasswordScreen}
        options={{ title: 'Change password' }}
      />
    </AccountStack.Navigator>
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
        <Tabs.Navigator
          screenOptions={{
            headerShown: false,
            // Labels only, and the empty icon slot is deliberate rather than an
            // omission: without it React Navigation reserves space and renders
            // a placeholder, which on a device with no icon font resolves to a
            // missing-glyph box. Three tabs with one-word names do not need
            // pictures, and a wrong picture is worse than none.
            tabBarIcon: () => null,
            // No explicit height or bottom padding: the navigator adds the
            // safe-area inset itself, and overriding the height made the
            // labels sit underneath Android's gesture bar.
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: { fontSize: 15, fontWeight: '700' },
          }}
        >
          <Tabs.Screen name="Work" component={TripsNavigator} options={{ title: 'Work' }} />
          <Tabs.Screen name="TimeOff" component={TimeOffScreen} options={{ title: 'Time off' }} />
          <Tabs.Screen name="Account" component={AccountNavigator} options={{ title: 'Account' }} />
        </Tabs.Navigator>

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
