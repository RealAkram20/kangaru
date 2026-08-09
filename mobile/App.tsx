import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/auth/AuthProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SyncProvider } from './src/offline/SyncProvider';

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
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
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
  );
}
