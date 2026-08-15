import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { AvailabilityKind, TripStatus } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { onSessionExpired } from '../auth/sessionEvents';
import { OUTBOX_TICK_INTERVAL_MS } from '../config';
import { GpsPingBuffer } from '../location/GpsPingBuffer';
import { GpsStreamer } from '../location/GpsStreamer';
import { openDatabase } from './db';
import { HttpOutboxTransport } from './httpTransport';
import { OutboxProcessor } from './outbox';
import type { OutboxItem, OutboxStore } from './outboxTypes';
import { SqliteOutboxStore } from './sqliteOutboxStore';

export type SyncState = {
  ready: boolean;
  online: boolean;
  /** Items still to go out. The number the driver watches drop. */
  pending: number;
  /** Items that need a person. Surfaced, never hidden. */
  parked: OutboxItem[];
  bufferedPings: number;
  lastSyncedAt: number | null;
};

type SyncValue = SyncState & {
  queueTransition: (input: {
    tripId: number;
    from: TripStatus;
    to: TripStatus;
    notes?: string;
    odometerStart?: number;
    odometerEnd?: number;
    photoUri?: string | null;
  }) => Promise<void>;
  queueAvailabilityRequest: (input: {
    kind: AvailabilityKind;
    starts_at: string;
    ends_at: string | null;
    reason: string;
  }) => Promise<void>;
  queueAvailabilityWithdrawal: (id: number) => Promise<void>;
  dismissParked: (id: string) => Promise<void>;
  sync: () => Promise<void>;
  gps: GpsStreamer | null;
};

const SyncContext = createContext<SyncValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { api, user } = useAuth();
  const queryClient = useQueryClient();

  const storeRef = useRef<OutboxStore | null>(null);
  const processorRef = useRef<OutboxProcessor | null>(null);
  const bufferRef = useRef<GpsPingBuffer | null>(null);
  // Held as a ref as well as state: `sync` flushes GPS, and taking the
  // streamer as a dependency would rebuild the reconnect and foreground
  // listeners every time it changed.
  const gpsRef = useRef<GpsStreamer | null>(null);
  const [gps, setGps] = useState<GpsStreamer | null>(null);

  const [state, setState] = useState<SyncState>({
    ready: false,
    online: true,
    pending: 0,
    parked: [],
    bufferedPings: 0,
    lastSyncedAt: null,
  });

  const refreshState = useCallback(async () => {
    const store = storeRef.current;
    const buffer = bufferRef.current;

    if (store === null) {
      return;
    }

    const [items, bufferedPings] = await Promise.all([
      store.all(),
      buffer === null ? Promise.resolve(0) : buffer.count(),
    ]);

    setState((previous) => ({
      ...previous,
      pending: items.filter((item) => item.state === 'pending').length,
      parked: items.filter((item) => item.state === 'parked'),
      bufferedPings,
    }));
  }, []);

  useEffect(() => {
    void (async () => {
      const db = await openDatabase();
      const store = new SqliteOutboxStore(db);
      const buffer = new GpsPingBuffer(db);
      const transport = new HttpOutboxTransport(api);

      storeRef.current = store;
      bufferRef.current = buffer;
      processorRef.current = new OutboxProcessor({
        store,
        transport,
        onParked: () => {
          void refreshState();
        },
      });

      const streamer = new GpsStreamer({ api, buffer });
      gpsRef.current = streamer;
      setGps(streamer);
      setState((previous) => ({ ...previous, ready: true }));
      await refreshState();
    })();
  }, [api, refreshState]);

  const sync = useCallback(async () => {
    const processor = processorRef.current;

    if (processor === null) {
      return;
    }

    // Both queues drain on the same signal. Coverage coming back is the only
    // event either of them is waiting for, and leaving GPS to its own 30-second
    // timer would hold a long offline batch back for no reason.
    const [outcome] = await Promise.all([processor.drain(), gpsRef.current?.flush()]);

    if (outcome.completed > 0) {
      // Something the server now knows about that this app's cache does not.
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      // A completed trip moves money: `DriverLedgerService` credits the
      // driver's share and records the cash they are holding. Without this,
      // the home screen's Earnings today and Wallet balance tiles — and the
      // completion screen's wallet card — kept showing pre-trip figures until
      // their 60-second `staleTime` happened to lapse.
      await queryClient.invalidateQueries({ queryKey: ['driver-stats'] });
      // And the earnings screen, which reads the same ledger over a period.
      // All three tabs share the key prefix, so one call covers them.
      await queryClient.invalidateQueries({ queryKey: ['driver-earnings'] });
      // And the wallet statement — a completed trip writes two ledger rows,
      // which are exactly what that screen lists.
      await queryClient.invalidateQueries({ queryKey: ['driver-ledger'] });
      // And the trip history, where the trip that just flushed is the newest
      // row. Every chip shares the key prefix, so one call covers all three.
      await queryClient.invalidateQueries({ queryKey: ['trip-history'] });
      setState((previous) => ({ ...previous, lastSyncedAt: Date.now() }));
    }

    await refreshState();
  }, [queryClient, refreshState]);

  /**
   * The outbox pauses on a 401 rather than failing its items, so it needs
   * telling when a session comes back. Without this a driver who
   * re-authenticates mid-shift would sit on a full queue until the next app
   * launch.
   */
  useEffect(() => {
    if (user !== null) {
      processorRef.current?.resume();
      void sync();
    }
  }, [user, sync]);

  useEffect(() => onSessionExpired(() => void refreshState()), [refreshState]);

  // Coverage coming back is the event this whole subsystem waits for.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      const online = netState.isConnected === true && netState.isInternetReachable !== false;

      setState((previous) => ({ ...previous, online }));

      if (online) {
        void sync();
      }
    });

    return unsubscribe;
  }, [sync]);

  // Coming back to the app is the other one: a driver who pocketed the phone
  // in a dead zone and reopens it in town expects the queue to move.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void sync();
      }
    });

    return () => subscription.remove();
  }, [sync]);

  useEffect(() => {
    const timer = setInterval(() => void sync(), OUTBOX_TICK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [sync]);

  const queueTransition = useCallback<SyncValue['queueTransition']>(
    async (input) => {
      const store = storeRef.current;

      if (store === null) {
        throw new Error('The offline queue is not ready yet.');
      }

      await store.enqueue({
        id: Crypto.randomUUID(),
        kind: 'trip_transition',
        // One stream per trip: items for the same trip are strictly ordered
        // and block each other, items for different trips never wait
        // (ADR-0023 §5).
        streamKey: `trip:${input.tripId}`,
        tripId: input.tripId,
        // Recorded at the tap, not at send time. This is what tells a
        // reconciliation the difference between "my write is missing" and
        // "the trip moved on without me".
        expectedFrom: input.from,
        targetStatus: input.to,
        photoUri: input.photoUri ?? null,
        payload: {
          to: input.to,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.odometerStart === undefined ? {} : { odometer_start: input.odometerStart }),
          ...(input.odometerEnd === undefined ? {} : { odometer_end: input.odometerEnd }),
        },
      });

      await refreshState();
      void sync();
    },
    [refreshState, sync],
  );

  const queueAvailabilityRequest = useCallback<SyncValue['queueAvailabilityRequest']>(
    async (payload) => {
      const store = storeRef.current;

      if (store === null) {
        throw new Error('The offline queue is not ready yet.');
      }

      await store.enqueue({
        id: Crypto.randomUUID(),
        kind: 'availability_request',
        streamKey: 'availability',
        tripId: null,
        expectedFrom: null,
        targetStatus: null,
        photoUri: null,
        payload,
      });

      await refreshState();
      void sync();
    },
    [refreshState, sync],
  );

  const queueAvailabilityWithdrawal = useCallback(
    async (id: number) => {
      const store = storeRef.current;

      if (store === null) {
        return;
      }

      await store.enqueue({
        id: Crypto.randomUUID(),
        kind: 'availability_withdraw',
        streamKey: 'availability',
        tripId: null,
        expectedFrom: null,
        targetStatus: null,
        photoUri: null,
        payload: { id },
      });

      await refreshState();
      void sync();
    },
    [refreshState, sync],
  );

  const dismissParked = useCallback(
    async (id: string) => {
      await storeRef.current?.discard(id);
      await refreshState();
    },
    [refreshState],
  );

  const value = useMemo(
    () => ({
      ...state,
      queueTransition,
      queueAvailabilityRequest,
      queueAvailabilityWithdrawal,
      dismissParked,
      sync,
      gps,
    }),
    [
      state,
      queueTransition,
      queueAvailabilityRequest,
      queueAvailabilityWithdrawal,
      dismissParked,
      sync,
      gps,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const value = useContext(SyncContext);

  if (value === null) {
    throw new Error('useSync must be used inside a SyncProvider.');
  }

  return value;
}
