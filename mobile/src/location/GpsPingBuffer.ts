import type * as SQLite from 'expo-sqlite';

import { MAX_BUFFERED_PINGS, MAX_PINGS_PER_REQUEST, type Ping } from './pings';

type Row = {
  id: number;
  trip_id: number;
  lat: number;
  lng: number;
  recorded_at: string;
  speed_kph: number | null;
  heading_degrees: number | null;
  accuracy_metres: number | null;
};

export type BufferedBatch = {
  tripId: number;
  pings: Ping[];
  /** Row ids to delete once the server has answered 202. */
  rowIds: number[];
};

/**
 * Durable storage for GPS pings between capture and upload.
 *
 * A second queue rather than a second kind of outbox item, per ADR-0023 §7.
 * Pings are at-least-once and need no reconciliation: a duplicated point
 * contributes a zero-length segment that `RouteDistanceCalculator` drops below
 * its noise floor, and `TripRouteRecorder` keeps the newest position by
 * `recorded_at`, so a replayed batch cannot walk the live marker backwards.
 *
 * Putting them through the outbox would make every batch pay for a
 * reconciling `GET`, and would let a stalled batch of pings sit in front of a
 * trip completion.
 */
export class GpsPingBuffer {
  constructor(
    private readonly db: SQLite.SQLiteDatabase,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  async record(tripId: number, ping: Ping): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO gps_pings (trip_id, lat, lng, recorded_at, speed_kph, heading_degrees, accuracy_metres)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      tripId,
      ping.position.lat,
      ping.position.lng,
      ping.recordedAt,
      ping.speedKph,
      ping.headingDegrees,
      ping.accuracyMetres,
    );

    await this.enforceCap();
  }

  /**
   * The oldest unsent batch, for one trip.
   *
   * One trip per batch because the endpoint is per-trip. Oldest first so a
   * long offline stretch drains in the order it happened, which is the order
   * `recorded_at` will be read in anyway.
   */
  async nextBatch(): Promise<BufferedBatch | null> {
    const oldest = await this.db.getFirstAsync<{ trip_id: number }>(
      `SELECT trip_id FROM gps_pings ORDER BY id ASC LIMIT 1`,
    );

    if (oldest === null) {
      return null;
    }

    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM gps_pings WHERE trip_id = ? ORDER BY id ASC LIMIT ?`,
      oldest.trip_id,
      MAX_PINGS_PER_REQUEST,
    );

    return {
      tripId: oldest.trip_id,
      rowIds: rows.map((row) => row.id),
      pings: rows.map((row) => ({
        position: { lat: row.lat, lng: row.lng },
        recordedAt: row.recorded_at,
        speedKph: row.speed_kph,
        headingDegrees: row.heading_degrees,
        accuracyMetres: row.accuracy_metres,
      })),
    };
  }

  /** Called only after a 202. Anything else leaves the batch where it is. */
  async discard(rowIds: number[]): Promise<void> {
    if (rowIds.length === 0) {
      return;
    }

    await this.db.runAsync(
      `DELETE FROM gps_pings WHERE id IN (${rowIds.map(() => '?').join(',')})`,
      ...rowIds,
    );
  }

  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM gps_pings`,
    );

    return row?.total ?? 0;
  }

  /**
   * Drops the oldest pings past the cap, and says so.
   *
   * Losing the *oldest* is the right end to lose from: the newest pings are
   * the ones a live map and a recent trip need, and the trips the oldest
   * belong to have long since been completed and reconciled. The log line is
   * not decoration — a cap nobody is told about reads as complete coverage.
   */
  private async enforceCap(): Promise<void> {
    const total = await this.count();

    if (total <= MAX_BUFFERED_PINGS) {
      return;
    }

    const excess = total - MAX_BUFFERED_PINGS;

    await this.db.runAsync(
      `DELETE FROM gps_pings WHERE id IN (SELECT id FROM gps_pings ORDER BY id ASC LIMIT ?)`,
      excess,
    );

    this.warn(
      `GPS buffer full: dropped ${excess} of the oldest pings. The device has been offline a long time.`,
    );
  }
}
