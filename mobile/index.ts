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

/*
 * **The third thing on this path that must exist before React, and the newest.**
 *
 * `TaskManager.defineTask` inside `offerPushTask` runs on this import, at
 * module scope, because the OS starts the app *into* the task when a push
 * arrives at a process that is not running. That is the whole point of it: the
 * call notification is built in JavaScript, so without something alive to build
 * it a driver gets the server's plain push — no buttons, and a ring that plays
 * once.
 *
 * Same warning as the two above, and it applies to both halves. Removing the
 * import fails nothing and leaves a task that is registered and undefined;
 * removing the `registerOfferPushTask()` call below fails nothing and leaves a
 * task that is defined and never triggered. Either way the app works perfectly
 * on a desk, where the process is always running.
 */
import { registerOfferPushTask } from './src/push/offerPushTask';
import { enableFreeze } from 'react-native-screens';
import * as Sentry from '@sentry/react-native';
import { startObservability } from './src/observability';
import { startTracing } from './src/tracing';

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

/*
 * ADR-0054 §4, and it has to be this line rather than an `integrations:` entry
 * in `Sentry.init` — see `src/tracing.ts`. Immediately after the init above,
 * because an integration added after the first screen change has missed it.
 * A no-op without a DSN, like everything else on this path.
 */
startTracing();

registerOfferBackgroundHandler();
registerOfferPushTask();

/*
 * **`Sentry.wrap`, and it is not decoration.**
 *
 * Without it the app-start measurement stops when the JavaScript bundle
 * finishes evaluating; with it, it stops when the first component mounts —
 * which on this app is the difference between timing the bundle and timing
 * the four things `App.tsx` starts in parallel on mount (the persisted query
 * cache, the keystore session read, the outbox's SQLite open, the fonts).
 * Cold start is a driver's first impression of the app and those four are
 * what it is made of.
 *
 * It also mounts the SDK's touch boundary, which leaves a breadcrumb naming
 * the *component* a driver last tapped. Component names only — no text, no
 * accessibility label, no passenger detail. That matters here because
 * ADR-0054 §2 already sends the request body, and this deliberately adds
 * nothing to what a report can see.
 *
 * registerRootComponent calls AppRegistry.registerComponent('main', () => App);
 * It also ensures that whether you load the app in Expo Go or in a native build,
 * the environment is set up appropriately
 */
registerRootComponent(Sentry.wrap(App));
