import * as SQLite from 'expo-sqlite';

/**
 * The app's durable store.
 *
 * SQLite rather than AsyncStorage, for the reason ADR-0023 §1 gives: enqueueing
 * into AsyncStorage means reading a JSON array, pushing, and writing it back,
 * and an app killed between the read and the write loses everything queued.
 * That kill is not hypothetical — the OS reclaims a backgrounded app on the
 * cheap handsets this runs on, and it does it while the driver is in a dead
 * zone with a captured odometer reading sitting in the queue.
 *
 * WAL because a GPS flush and an outbox drain can be writing at the same
 * moment, and the default journal makes one of them wait on the other.
 */
const DATABASE_NAME = 'kangaruride-driver.db';

let database: SQLite.SQLiteDatabase | null = null;

export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database !== null) {
    return database;
  }

  const opened = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await opened.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS outbox (
      sequence         INTEGER PRIMARY KEY AUTOINCREMENT,
      id               TEXT NOT NULL UNIQUE,
      kind             TEXT NOT NULL,
      stream_key       TEXT NOT NULL,
      payload          TEXT NOT NULL,
      trip_id          INTEGER,
      expected_from    TEXT,
      target_status    TEXT,
      photo_uri        TEXT,
      state            TEXT NOT NULL DEFAULT 'pending',
      attempts         INTEGER NOT NULL DEFAULT 0,
      inflight_at      INTEGER,
      next_attempt_at  INTEGER NOT NULL DEFAULT 0,
      last_error_code  TEXT,
      last_error_message TEXT,
      created_at       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (state, sequence);

    CREATE TABLE IF NOT EXISTS gps_pings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id     INTEGER NOT NULL,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      speed_kph   REAL,
      heading_degrees INTEGER,
      accuracy_metres REAL
    );

    CREATE INDEX IF NOT EXISTS gps_pings_trip ON gps_pings (trip_id, id);
  `);

  database = opened;

  return opened;
}

/** Tests and sign-out reset the handle so the next open re-runs the schema. */
export function resetDatabaseHandle(): void {
  database = null;
}
