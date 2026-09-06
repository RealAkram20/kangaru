import * as Location from 'expo-location';

import type { ApiClient } from '../api/client';
import { isOutcomeUnknown } from '../api/errors';
import type { GpsPingBuffer } from './GpsPingBuffer';
import { looksLikeServiceArea, toPingBody, type Ping } from './pings';

/**
 * The target cadence from `docs/driver-app-brief.md`: one ping per 10 seconds
 * per active vehicle, which is what PROJECT.md's 200-writes-per-second figure
 * is sized against. Changing it here changes the platform's ingestion load.
 */
const PING_INTERVAL_MS = 10_000;

/**
 * 25 metres. A vehicle in traffic still reports on the interval; the distance
 * filter only stops a *parked* vehicle burning battery on GPS jitter, and the
 * server-side calculator already discards those segments as noise.
 */
const PING_DISTANCE_METRES = 25;

/** Upload every half minute: fifteen or so pings a batch on a good connection. */
const FLUSH_INTERVAL_MS = 30_000;

export type GpsStreamerOptions = {
  api: ApiClient;
  buffer: GpsPingBuffer;
  onError?: (message: string) => void;
};

/**
 * Streams GPS for the trip that is live.
 *
 * Capture and upload are separated on purpose: `expo-location` calls back on
 * its own schedule and must never wait on a request, and the pings have to
 * survive the gap between the two. So the watcher writes to SQLite and the
 * flusher reads from it, and a dead zone simply means the second half stops
 * for a while.
 *
 * Which statuses stream at all is `shouldStreamGps` in `src/trips/
 * transitions.ts`, and the window is narrower than it looks — see the
 * reasoning there about variance flagging.
 */
export class GpsStreamer {
  private subscription: Location.LocationSubscription | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private tripId: number | null = null;
  private flushing = false;

  constructor(private readonly options: GpsStreamerOptions) {}

  activeTripId(): number | null {
    return this.tripId;
  }

  /**
   * Begins streaming for a trip, or switches to a different one.
   *
   * Returns false when the driver has not granted location permission. That is
   * reported rather than thrown: a trip whose GPS trace is missing is a trip
   * with `gps_distance_km` null, which `TripStateMachine` deliberately leaves
   * *unflagged* — no GPS evidence is not the same as a disagreement — so the
   * driver is warned and the work continues.
   */
  async start(tripId: number): Promise<boolean> {
    if (this.tripId === tripId && this.subscription !== null) {
      return true;
    }

    await this.stop();

    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      this.options.onError?.(
        'Location is off, so this trip will have no GPS route. Turn it on in Settings.',
      );

      return false;
    }

    this.tripId = tripId;

    this.subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: PING_INTERVAL_MS,
        distanceInterval: PING_DISTANCE_METRES,
      },
      (reading) => {
        void this.capture(tripId, reading);
      },
    );

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);

    return true;
  }

  async stop(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    this.tripId = null;

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // One last attempt on the way out. A trip completed inside coverage should
    // not leave its final pings waiting for a timer that no longer runs.
    await this.flush();
  }

  private async capture(tripId: number, reading: Location.LocationObject): Promise<void> {
    const ping: Ping = {
      position: { lat: reading.coords.latitude, lng: reading.coords.longitude },
      // The device clock at capture, per the brief. `reading.timestamp` is
      // milliseconds since the epoch on this handset.
      recordedAt: new Date(reading.timestamp).toISOString(),
      speedKph: reported(reading.coords.speed, (value) => round(value * 3.6, 1)),
      headingDegrees: normaliseHeading(reading.coords.heading),
      accuracyMetres: reported(reading.coords.accuracy, (value) => round(value, 1)),
      // The OS's own verdict, passed through (ADR-0045). Android marks a fix
      // produced by a mock-location app; iOS does not report the field at
      // all, and `undefined` is stored as false — "the device did not say
      // so", which is the honest reading of silence.
      isMock: reading.mocked === true,
    };

    if (__DEV__ && !looksLikeServiceArea(ping.position)) {
      console.warn(
        `Position outside the service area: lat ${ping.position.lat}, lng ${ping.position.lng}. ` +
          'If this is Uganda, the two fields have been swapped somewhere.',
      );
    }

    await this.options.buffer.record(tripId, ping);
  }

  /**
   * Uploads buffered pings until the buffer is empty or the network refuses.
   *
   * Rows are deleted only after the server answers, and the server answers 202
   * rather than 201 — the pings are validated and buffered, not yet written
   * (ADR-0003). Deleting on anything less would trade a durable local copy for
   * a promise.
   */
  async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }

    this.flushing = true;

    try {
      for (;;) {
        const batch = await this.options.buffer.nextBatch();

        if (batch === null || batch.pings.length === 0) {
          return;
        }

        try {
          await this.options.api.request(`/trips/${batch.tripId}/locations`, {
            method: 'POST',
            body: { pings: batch.pings.map(toPingBody) },
            // Generous: a 500-ping catch-up batch after a long dead zone is a
            // big body on a weak connection, and losing it to a timeout means
            // sending it all again.
            timeoutMs: 45_000,
          });

          await this.options.buffer.discard(batch.rowIds);
        } catch (error) {
          // Still offline, or the server is unwell. The batch stays put; the
          // next timer tick tries again. A definite refusal (403, 404 — the
          // trip is no longer this driver's) also stops the loop rather than
          // spinning, and the pings stay until the buffer cap reclaims them.
          if (!isOutcomeUnknown(error)) {
            this.options.onError?.('GPS could not be uploaded for this trip.');
          }

          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * A figure the platform actually reported, or null.
 *
 * **`=== null` was not enough, and the gap was invisible to the type system.**
 * Expo types `speed`, `heading` and `accuracy` as `number | null`, but a fix
 * can omit them — an Android emulator does it constantly — and `undefined`
 * walks straight past a null check into the arithmetic: `undefined * 3.6` is
 * NaN, and `typeof NaN` is `'number'`, so it satisfies `number | null` and
 * travels all the way to SQLite. The native binder cannot cast NaN and
 * rejects the whole statement, so **one missing field dropped the entire
 * ping** — and pings are what ADR-0045 measures a trip's distance from.
 *
 * Found in Sentry as `NativeDatabase.prepareAsync has been rejected`, three
 * layers from the cause.
 */
function reported(value: number | null, map: (value: number) => number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? map(value) : null;
}

/**
 * The API takes an integer 0–359. A device reports -1 when it has no fix on
 * heading, and 360 is the same bearing as 0 — both would be a 422 that costs
 * the whole batch.
 *
 * The `Number.isFinite` half is `reported`'s guard, for the same reason: an
 * absent heading arrives as `undefined` on some fixes, and `Math.round` turns
 * that into NaN rather than refusing it.
 */
function normaliseHeading(heading: number | null): number | null {
  if (typeof heading !== 'number' || !Number.isFinite(heading) || heading < 0) {
    return null;
  }

  return Math.round(heading) % 360;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;

  return Math.round(value * factor) / factor;
}
