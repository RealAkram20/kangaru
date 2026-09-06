import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

/**
 * Navigating into a tab from outside it (`DrawerContent.go`,
 * `navigationRef.openPickup`, `navigationRef.openTrip`).
 *
 * ## The bug, which the owner found and I first misdiagnosed
 *
 * *"If I open Promotions and then I try to click the Profile it does not work
 * — this is application wide."*
 *
 * Navigating into a nested navigator that **has not been rendered yet** does
 * not push onto its stack, because there is no stack. React Navigation builds
 * the child's *initial state* out of what it was handed, so the Profile stack
 * came into existence as `["Promotions"]` at index 0 — `ProfileHome` never in
 * it at all.
 *
 * From index 0 there is nothing to pop, so pressing the Profile tab did
 * nothing, while the other three tabs — sitting at their own roots — kept
 * switching normally. Android's back gesture left the app for the same
 * reason: a stack of one has nothing behind it.
 *
 * `initial: false` is the documented fix and it is one word per call site.
 *
 * ## Why this test is shaped the way it is
 *
 * **The drawer is not in it.** `@react-navigation/drawer` pulls in Reanimated,
 * whose Jest mock fails to load under this RN version. An outer stack stands
 * in for it, which preserves the thing that matters — three levels, with the
 * navigate crossing two of them — and the assertion is on navigation *state*
 * rather than on rendered text, so nothing here depends on which navigator is
 * on top.
 *
 * **It asserts the state, not the pixels.** An earlier attempt asserted what
 * was on screen and passed against a deliberately broken fix, because
 * `findByText` polls and the tree settled underneath it. Reading
 * `getRootState()` after an explicit flush is the only form that stayed
 * honest.
 */

const Outer = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const ProfileStack = createNativeStackNavigator();
const HomeStack = createNativeStackNavigator();

/** A screen that renders its own name, so a stack can be read off the tree. */
function Plain(label: string) {
  const Screen = () => (
    <View>
      <Text>{label}</Text>
    </View>
  );

  // Named, because an anonymous component here is a lint error and, more
  // usefully, an unreadable entry in any tree this test ever prints.
  Screen.displayName = `Screen(${label})`;

  return Screen;
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileHome" component={Plain('profile-home')} />
      <ProfileStack.Screen name="Promotions" component={Plain('promotions')} />
    </ProfileStack.Navigator>
  );
}

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="TripsHome" component={Plain('trips-home')} />
    </HomeStack.Navigator>
  );
}

function TabsNavigator() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="Home" component={HomeNavigator} />
      <Tabs.Screen
        name="Profile"
        component={ProfileNavigator}
        // Mirrors `RootNavigator`. Without it the tab restores whatever was
        // last on this stack, which is how pressing Profile landed a driver
        // in the inbox they had opened from Home's bell.
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Profile', { screen: 'ProfileHome' });
          },
        })}
      />
    </Tabs.Navigator>
  );
}

/** Mounts the tree and hands back the navigation the drawer would have used. */
async function boot() {
  let outer: { navigate: (name: string, params: unknown) => void } | null = null;
  let container: { getRootState: () => Record<string, never> } | null = null;

  const view = await render(
    <NavigationContainer ref={(ref) => { container = ref as never; }}>
      <Outer.Navigator screenOptions={{ headerShown: false }}>
        <Outer.Screen name="Main">
          {(props: { navigation: typeof outer }) => {
            outer = props.navigation;

            return <TabsNavigator />;
          }}
        </Outer.Screen>
      </Outer.Navigator>
    </NavigationContainer>,
  );

  /** The focused tab's own stack, as `{ index, routes }`. */
  const stack = () => {
    const root = (container as never as { getRootState: () => never }).getRootState() as never as {
      index: number;
      routes: { state?: { index: number; routes: { name: string; state?: unknown }[] } }[];
    };
    const tabs = root.routes[root.index]?.state;
    const focused = tabs?.routes[tabs.index] as { state?: { index: number; routes: { name: string }[] } };

    return focused?.state;
  };

  return { view, stack, go: (params: unknown) => outer?.navigate('Main', params) };
}

/** Dispatch and let React Navigation settle — its state lands asynchronously. */
async function settle(run: () => void) {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

it('keeps the tab root underneath a screen opened from outside the tab', async () => {
  const { stack, go } = await boot();

  await settle(() =>
    go({ screen: 'Profile', params: { screen: 'Promotions', initial: false } }),
  );

  expect(stack()?.routes.map((route) => route.name)).toEqual(['ProfileHome', 'Promotions']);
  // Non-zero is the whole point: it is what leaves something to pop back to,
  // for the tab bar and for the back gesture alike.
  expect(stack()?.index).toBe(1);
});

/**
 * The shipped behaviour, kept as the counter-example so the flag above is
 * known to be doing something. Remove `initial: false` from
 * `DrawerContent.go` and the app returns to exactly this.
 */
it('drops the tab root when the flag is omitted, which is what broke the tab', async () => {
  const { stack, go } = await boot();

  await settle(() => go({ screen: 'Profile', params: { screen: 'Promotions' } }));

  expect(stack()?.routes.map((route) => route.name)).toEqual(['Promotions']);
  expect(stack()?.index).toBe(0);
});

/**
 * Pressing the Profile tab lands on Profile.
 *
 * The owner, 2026-08-28: *"now when I click on the profile it sends us to the
 * notifications."* `Notifications` is a screen on the Profile stack that
 * nothing inside Profile reaches — `HomeScreen`'s bell pushes it there from
 * another tab — and React Navigation then does what it should: it remembers.
 * So the tab kept restoring an inbox opened half an hour earlier, with the
 * account the driver was reaching for one Back press away and nothing saying
 * so.
 *
 * `Promotions` stands in for it here, exactly as it does above: same stack,
 * same shape, and it is the screen the owner first reported this class of bug
 * against.
 */
it('returns the Profile tab to its own root when the tab is pressed', async () => {
  const { view, stack, go } = await boot();

  await settle(() =>
    go({ screen: 'Profile', params: { screen: 'Promotions', initial: false } }),
  );

  expect(stack()?.index).toBe(1);

  /*
    **Away to Home first, and that step is the whole test.**

    An earlier version pressed Profile while Profile was already focused. It
    passed with the listener deliberately removed, because re-pressing the
    focused tab pops its stack to the top all on its own — the test proved
    nothing and was caught by mutating the listener away.

    The reported bug is a tab *switch*: the driver is on Home, presses
    Profile, and React Navigation restores whatever that stack last showed.
    That is the path this now walks.
  */
  await settle(() => {
    void fireEvent.press(view.getByLabelText('Home, tab, 1 of 2'));
  });

  await settle(() => {
    void fireEvent.press(view.getByLabelText('Profile, tab, 2 of 2'));
  });

  // **The screen above is popped, not merely unfocused**, because
  // `navigate` to a route already in the stack returns to it and discards
  // what sat on top. Asserted rather than assumed: an earlier version of
  // this test expected `['ProfileHome', 'Promotions']` and was simply wrong
  // about what the fix does.
  //
  // It is the behaviour worth having. A driver pressing Profile is not
  // asking to keep an inbox they opened from Home half an hour ago behind
  // the account screen; leaving it there would put a back gesture on Profile
  // that goes somewhere they never navigated from.
  expect(stack()?.routes.map((route) => route.name)).toEqual(['ProfileHome']);
  expect(stack()?.index).toBe(0);
});
