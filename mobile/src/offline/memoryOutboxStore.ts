import type { NewOutboxItem, OutboxItem, OutboxStore } from './outboxTypes';

/**
 * An in-memory `OutboxStore`, for tests.
 *
 * Rows are cloned on the way in and on the way out, so a test that mutates a
 * returned item cannot accidentally reach into the store and make the
 * processor look correct when it is not — the same isolation a real database
 * gives for free, and the absence of which would turn every assertion here
 * into a false green.
 *
 * "The app was killed" is modelled by building a new processor over the same
 * store instance: the rows survive, everything in memory does not, which is
 * exactly the boundary SQLite draws in production.
 */
export class MemoryOutboxStore implements OutboxStore {
  private rows: OutboxItem[] = [];
  private nextSequence = 1;

  async enqueue(item: NewOutboxItem): Promise<OutboxItem> {
    const row: OutboxItem = {
      ...item,
      state: 'pending',
      attempts: 0,
      inflightAt: null,
      nextAttemptAt: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: item.createdAt ?? 0,
      sequence: this.nextSequence++,
    };

    this.rows.push(row);

    return { ...row };
  }

  async pending(): Promise<OutboxItem[]> {
    return this.rows
      .filter((row) => row.state === 'pending')
      .sort((a, b) => a.sequence - b.sequence)
      .map((row) => ({ ...row }));
  }

  async all(): Promise<OutboxItem[]> {
    return this.rows.sort((a, b) => a.sequence - b.sequence).map((row) => ({ ...row }));
  }

  async markInflight(id: string, at: number): Promise<void> {
    this.update(id, (row) => {
      row.inflightAt = at;
      row.attempts += 1;
    });
  }

  async clearInflight(id: string): Promise<void> {
    this.update(id, (row) => {
      row.inflightAt = null;
    });
  }

  async complete(id: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  async park(id: string, code: string, message: string): Promise<void> {
    this.update(id, (row) => {
      row.state = 'parked';
      row.inflightAt = null;
      row.lastErrorCode = code;
      row.lastErrorMessage = message;
    });
  }

  async reschedule(id: string, nextAttemptAt: number, code: string, message: string): Promise<void> {
    this.update(id, (row) => {
      row.nextAttemptAt = nextAttemptAt;
      row.lastErrorCode = code;
      row.lastErrorMessage = message;
    });
  }

  async discard(id: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  private update(id: string, mutate: (row: OutboxItem) => void): void {
    const row = this.rows.find((candidate) => candidate.id === id);

    if (row) {
      mutate(row);
    }
  }
}
