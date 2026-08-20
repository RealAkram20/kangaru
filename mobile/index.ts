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

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
