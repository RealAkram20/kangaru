import type { AvailabilityKind, TripStatus } from '../api/types';

export type OutboxKind = 'trip_transition' | 'availability_request' | 'availability_withdraw';

/**
 * `pending` is waiting to go out. `parked` needs a person: the payload is kept
 * and shown to the driver. Nothing here deletes user-entered data — an
 * odometer reading that vanishes because a request failed is the exact failure
 * ADR-0023 exists to prevent.
 */
export type OutboxState = 'pending' | 'parked';

export type TransitionPayload = {
  to: TripStatus;
  notes?: string;
  odometer_start?: number;
  odometer_end?: number;
  /**
   * Which stop a pause is an arrival at (ADR-0045 §2). Only ever set with
   * `to: 'waiting'`; the resume pairs itself server-side with whichever stop
   * is open, so it never carries one.
   */
  stop_id?: number;
};

export type AvailabilityRequestPayload = {
  kind: AvailabilityKind;
  starts_at: string;
  ends_at: string | null;
  reason: string;
};

export type AvailabilityWithdrawPayload = { id: number };

export type OutboxPayload =
  | TransitionPayload
  | AvailabilityRequestPayload
  | AvailabilityWithdrawPayload;

export type OutboxItem = {
  id: string;
  kind: OutboxKind;
  /**
   * Items sharing a stream key are sent strictly in order and block one
   * another (ADR-0023 §5). One key per trip, plus one for leave requests.
   * Different streams never wait on each other — they share no server state to
   * be wrong about.
   */
  streamKey: string;
  payload: OutboxPayload;
  tripId: number | null;
  /** The trip's status when the driver tapped. Null for non-transition kinds. */
  expectedFrom: TripStatus | null;
  targetStatus: TripStatus | null;
  /** Local file URI of the dashboard photo, if one was taken. */
  photoUri: string | null;
  state: OutboxState;
  attempts: number;
  /**
   * Set immediately before a request goes out and cleared only on a
   * *classified* response. Non-null on load means the outcome of the last
   * attempt is unknown — the socket died, or the process did — and the item
   * must be reconciled before it is ever sent again (ADR-0023 §2, §3).
   */
  inflightAt: number | null;
  nextAttemptAt: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: number;
  /** Monotonic insert order. The only thing ordering depends on. */
  sequence: number;
};

export type NewOutboxItem = Omit<
  OutboxItem,
  'state' | 'attempts' | 'inflightAt' | 'nextAttemptAt' | 'lastErrorCode' | 'lastErrorMessage' | 'createdAt' | 'sequence'
> & { createdAt?: number };

/**
 * Durable storage for the queue.
 *
 * A port, so the processor's logic is exercised in tests against an in-memory
 * implementation while production runs the same code over SQLite. What the
 * port cannot verify is durability itself — that every write survives the
 * process — which is SQLite's job and is why AsyncStorage was rejected
 * (ADR-0023 §1). What it *can* verify, and what the tests assert, is that the
 * processor writes the things it must write in the order it must write them.
 */
export interface OutboxStore {
  enqueue(item: NewOutboxItem): Promise<OutboxItem>;
  /** Pending items, oldest first by sequence. */
  pending(): Promise<OutboxItem[]>;
  /** Everything, including parked — the sync screen reads this. */
  all(): Promise<OutboxItem[]>;
  markInflight(id: string, at: number): Promise<void>;
  clearInflight(id: string): Promise<void>;
  /** Sent successfully, or proven already applied. Removes the row. */
  complete(id: string): Promise<void>;
  park(id: string, code: string, message: string): Promise<void>;
  reschedule(id: string, nextAttemptAt: number, code: string, message: string): Promise<void>;
  /** Drops a parked item the driver has acknowledged. */
  discard(id: string): Promise<void>;
}
