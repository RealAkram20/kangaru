import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  QueryClient,
  defaultShouldDehydrateQuery,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StatusBar } from 'expo-status-bar';
import { AppState, View } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/auth/AuthProvider';
import { loadRingtonePreference } from './src/duty/ringtonePreference';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SyncProvider } from './src/offline/SyncProvider';
import { useBrandFonts } from './src/ui/fonts';
import { colors } from './src/ui/theme';

/**
 * The read cache is persisted to AsyncStorage, and only the read cache.
 *
 * This is the counterpart to the outbox, not a substitute for it. The queue of
 * things the driver has *done* lives in SQLite because losing one loses a
 * contractual data point (ADR-0023 §1); this is the list of things the office
 * has *said*, and losing it costs one refresh. Different stakes, different
 * storage — putting them in the same place would mean either over-engineering
 * the cache or under-engineering the queue.
 *
 * A day, because a driver who opens the app upcountry on the second morning of
 * a run should still see the work they were assigned.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      networkMode: 'offlineFirst',
      gcTime: 24 * 60 * 60 * 1000,
    },
    /*
     * Mutations too, and this line is load-bearing for every button in the
     * app. React Query's mutation default is `'online'`: fired while the
     * radio is out, the mutation *pauses* — `isPending` stays true, the
     * promise never settles, no catch runs — and every `busy`/`disabled`
     * bound to it stays on with nothing on screen saying why. That was the
     * Go Online button, Accept, Decline, and every upload, each frozen by
     * one tap in a dead zone. `offlineFirst` attempts the request
     * regardless; the attempt fails fast, the error reaches the screen's
     * own refusal handling, and the driver is told instead of stonewalled.
     * The mutations here are exactly the "statements about right now" that
     * duty/queries.ts argues must need a connection *and say so*.
     */
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'kangaruride.driver.queries',
  /*
   * The persister dehydrates and stringifies the whole cache on every cache
   * write, throttled to this window. Its default is one second — and the
   * offers poll writes every five, presence every heartbeat, so at the
   * default the JS thread was serialising a few hundred KB of cache about
   * as often as it repaints, right under the Accept button. Five seconds
   * keeps the day-old-cache guarantee (a kill loses at most one window)
   * at a twentieth of the cost.
   */
  throttleTime: 5_000,
});

/*
 * React Query's `refetchOnReconnect` and `refetchOnWindowFocus` both default to
 * true, and on React Native both are dead letters until wired up here.
 *
 * The library's default managers listen for the browser's `online` and
 * `visibilitychange` events. There is no `window` on a handset, so neither
 * manager ever fires and every query behaves as if the app were permanently
 * online and permanently focused.
 *
 * What that cost a driver: `SyncProvider` already subscribes to NetInfo and
 * AppState, but it only invalidates queries when the *outbox* drained
 * something. A driver who was purely reading — checking earnings, looking at
 * the ledger — backgrounds the app in a dead zone and reopens it in town, and
 * nothing refetches. The screens stay on yesterday's numbers until their
 * staleTime lapses *and* something happens to re-render them.
 *
 * Set once at module load, deliberately: these are process-wide singletons, so
 * doing it in a component would re-subscribe on every mount.
 */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    // `isInternetReachable` is null while the probe is still outstanding.
    // Treating null as offline would make the app pause requests every time
    // the radio changes; only a definite false means no route out.
    setOnline(state.isConnected === true && state.isInternetReachable !== false);
  }),
);

focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    setFocused(status === 'active');
  });
  return () => subscription.remove();
});

/*
 * Whether an offer is allowed to make a noise, read from disk into memory.
 *
 * Started here, at module load, rather than from an effect, because the ports
 * that consult it are synchronous by design — an `await` on the ring path
 * would let the first second of a job offer pass in silence. Starting it as
 * early as possible is what keeps the window in which the default applies
 * down to the app's own launch.
 *
 * Not awaited, and it does not need to be: the default until it lands is
 * *on*, which is the side that costs a driver nothing. See
 * `duty/ringtonePreference`.
 */
void loadRingtonePreference();

export default function App() {
  const fontsReady = useBrandFonts();

  // Held on a blank brand-coloured screen rather than rendered in the system
  // face and reflowed a beat later. Sora and Inter have different metrics to
  // Roboto, so painting first would move every heading on the screen once the
  // real faces land — and the first thing a driver would see the app do is
  // twitch.
  //
  // The gate holds only the navigator, deliberately — the providers mount
  // regardless. They render no text, so they have no stake in the fonts, and
  // each starts real work on mount: the persisted cache read, the keystore
  // session read, the outbox's SQLite open. Gating them too (as this file
  // once did) serialised cold start into fonts *then* all three; this way the
  // slowest of the four is the whole wait.
  return (
    /*
      **`GestureHandlerRootView` is required, not optional, and its absence is
      a native crash rather than a degraded gesture.**

      React Navigation's drawer is built on `react-native-gesture-handler`, and
      that library needs this at the root of the tree to attach its Android
      root view. Without it the app mounts, starts the navigator, throws inside
      the drawer, and closes — which from the outside looks like "it opens and
      then shuts", with **nothing in the Metro log**, because the failure is
      native and JS never gets to report it.

      Nothing caught this: the bundle compiles, `tsc` passes, eslint passes, and
      every Jest suite passes because `jest.setup.ts` mocks gesture-handler.
      Only running it on a handset finds it. It is the clearest example on this
      branch of why "run or render it" is a rule.

      `flex: 1` is part of the requirement — the library's own docs are explicit
      that this view must fill its parent, and a root view with no height
      renders an app that is present, correct and invisible.
    */
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: 24 * 60 * 60 * 1000,
            dehydrateOptions: {
              /*
               * Offers never touch disk. Their own query says it: "a cached
               * offer is only ever true at the instant it was fetched." A
               * persisted one is worse — restored on the next cold start, it
               * would present yesterday's job, ringtone and countdown and
               * all, to a driver it was long since taken from.
               */
              shouldDehydrateQuery: (query) =>
                defaultShouldDehydrateQuery(query) && query.queryKey[0] !== 'offers',
            },
          }}
        >
          <AuthProvider>
            <SyncProvider>
              {fontsReady ? (
                <RootNavigator />
              ) : (
                <View style={{ flex: 1, backgroundColor: colors.background }} />
              )}
            </SyncProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
