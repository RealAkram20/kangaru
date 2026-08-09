import type * as SQLite from 'expo-sqlite';

import type { TripStatus } from '../api/types';
import type { NewOutboxItem, OutboxItem, OutboxStore } from './outboxTypes';

type Row = {
  sequence: number;
  id: string;
  kind: string;
  stream_key: string;
  payload: string;
  trip_id: number | null;
  expected_from: string | null;
  target_status: string | null;
  photo_uri: string | null;
  state: string;
  attempts: number;
  inflight_at: number | null;
  next_attempt_at: number;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: number;
};

/**
 * The production `OutboxStore`. Each method is one statement, deliberately:
 * the durability guarantee in ADR-0023 §2 is that a single write has either
 * happened or not when the process dies, and a multi-statement update would
 * give it a middle.
 */
export class SqliteOutboxStore implements OutboxStore {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async enqueue(item: NewOutboxItem): Promise<OutboxItem> {
    const createdAt = item.createdAt ?? Date.now();

    const result = await this.db.runAsync(
      `INSERT INTO outbox
         (id, kind, stream_key, payload, trip_id, expected_from, target_status, photo_uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      item.kind,
      item.streamKey,
      JSON.stringify(item.payload),
      item.tripId,
      item.expectedFrom,
      item.targetStatus,
      item.photoUri,
      createdAt,
    );

    return {
      ...item,
      state: 'pending',
      attempts: 0,
      inflightAt: null,
      nextAttemptAt: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt,
      sequence: result.lastInsertRowId,
    };
  }

  async pending(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM outbox WHERE state = 'pending' ORDER BY sequence ASC`,
    );

    return rows.map(toItem);
  }

  async all(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<Row>(`SELECT * FROM outbox ORDER BY sequence ASC`);

    return rows.map(toItem);
  }

  async markInflight(id: string, at: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE outbox SET inflight_at = ?, attempts = attempts + 1 WHERE id = ?`,
      at,
      id,
    );
  }

  async clearInflight(id: string): Promise<void> {
    await this.db.runAsync(`UPDATE outbox SET inflight_at = NULL WHERE id = ?`, id);
  }

  async complete(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM outbox WHERE id = ?`, id);
  }

  async park(id: string, code: string, message: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE outbox
         SET state = 'parked', inflight_at = NULL, last_error_code = ?, last_error_message = ?
       WHERE id = ?`,
      code,
      message,
      id,
    );
  }

  async reschedule(id: string, nextAttemptAt: number, code: string, message: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE outbox SET next_attempt_at = ?, last_error_code = ?, last_error_message = ? WHERE id = ?`,
      nextAttemptAt,
      code,
      message,
      id,
    );
  }

  async discard(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM outbox WHERE id = ?`, id);
  }
}

function toItem(row: Row): OutboxItem {
  return {
    id: row.id,
    kind: row.kind as OutboxItem['kind'],
    streamKey: row.stream_key,
    payload: JSON.parse(row.payload),
    tripId: row.trip_id,
    expectedFrom: row.expected_from as TripStatus | null,
    targetStatus: row.target_status as TripStatus | null,
    photoUri: row.photo_uri,
    state: row.state as OutboxItem['state'],
    attempts: row.attempts,
    inflightAt: row.inflight_at,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    sequence: row.sequence,
  };
}
