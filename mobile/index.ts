import { registerRootComponent } from 'expo';

/*
 * **Imported for its side effect, and the side effect is the point.**
 *
 * `PresenceTask` calls `TaskManager.defineTask` at module scope. That has to
 * run during the bundle's evaluation, before React mounts anything, because
 * the operating system cold-starts the app *into* that task while the phone
 * is in a driver's pocket — and at that moment there is no component tree for
 * a `useEffect` to have run in.
 *
 * A linter or a tidy-up that removes this line as unused will not fail a test,
 * a typecheck or a lint run. It will produce an `expo-task-manager` warning in
 * logcat that nobody reads, and a presence heartbeat that works perfectly on
 * every desk and never once in the field. Leave it here.
 */
import './src/duty/PresenceTask';

/*
 * **Registered before React, for the same reason and with the same warning.**
 *
 * Android cold-starts this app *into* a notification button press: a driver
 * taps Accept on a locked phone and the runtime is created for that tap. No
 * component has mounted, so a handler registered inside React does not exist
 * at the only moment it is needed.
 *
 * Removing this line fails no test, no typecheck and no lint run. It produces
 * an Accept button that works on a desk and does nothing on a lock screen.
 */
import { registerOfferBackgroundHandler } from './src/push/offerBackgroundHandler';
import { enableFreeze } from 'react-native-screens';
import { startObservability } from './src/observability';

import App from './App';

/*
 * Screens behind the focused one stop rendering. Without this, a trip's whole
 * history of screens stays live: Home's map WebView, a backgrounded
 * TripInProgressScreen's once-a-second clock tick, every map the driver has
 * navigated past — all re-rendering behind the screen actually on display,
 * on the same JS thread that has to answer the next tap.
 */
enableFreeze(true);

/*
 * ADR-0054. First, and outside React, for the same reason the two handlers
 * above are: Android cold-starts this app into a notification tap with no
 * component tree, and a crash during that start is the one most worth
 * reporting. Inert without EXPO_PUBLIC_SENTRY_DSN, which is how development
 * and the Jest environment run.
 */
startObservability();

registerOfferBackgroundHandler();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
