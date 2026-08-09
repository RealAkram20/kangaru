import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { GpsController } from '../location/GpsController';
import { AccountScreen } from '../screens/AccountScreen';
import { PasswordScreen } from '../screens/PasswordScreen';
import { OdometerScreen } from '../screens/OdometerScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { TimeOffScreen } from '../screens/TimeOffScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { TripDetailScreen } from '../screens/TripDetailScreen';
import { colors } from '../ui/theme';
import type { AccountStackParams, RootTabParams, TripsStackParams } from './types';

const Tabs = createBottomTabNavigator<RootTabParams>();
const TripsStack = createNativeStackNavigator<TripsStackParams>();
const AccountStack = createNativeStackNavigator<AccountStackParams>();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    primary: colors.primary,
    border: colors.border,
  },
};

function TripsNavigator() {
  return (
    <TripsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <TripsStack.Screen name="Today" component={TodayScreen} options={{ title: "Today's work" }} />
      <TripsStack.Screen name="TripDetail" component={TripDetailScreen} options={{ title: 'Trip' }} />
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
        <SignInScreen />
      ) : (
        <>
        {/* Renders nothing; keeps GPS following the live trip regardless of
            which tab is open. */}
        <GpsController />
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
        </>
      )}
    </NavigationContainer>
  );
}
