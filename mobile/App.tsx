import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/auth/AuthProvider';
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
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'kangaruride.driver.queries',
});

export default function App() {
  const fontsReady = useBrandFonts();

  // Held on a blank brand-coloured screen rather than rendered in the system
  // face and reflowed a beat later. Sora and Inter have different metrics to
  // Roboto, so painting first would move every heading on the screen once the
  // real faces land — and the first thing a driver would see the app do is
  // twitch.
  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

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
          persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000 }}
        >
          <AuthProvider>
            <SyncProvider>
              <RootNavigator />
            </SyncProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
