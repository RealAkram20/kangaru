import type { Driver } from './driver'
import type { Vehicle } from './vehicle'

/**
 * A vehicle judged for one booking (ADR-0009 + ADR-0017).
 *
 * `dispatchable: false` means the assignment endpoint will answer 409
 * whatever the board sends — the list is a preview of the rule, never the
 * rule itself.
 */
export interface CandidateVehicle extends Vehicle {
  /** Contracted to this client for this date; ranks first. */
  allocated: boolean
  dispatchable: boolean
  /**
   * POSTing this vehicle without `allocation_override_reason` gets a 422, so
   * a form can collect one before the dispatcher is bounced.
   */
  requires_override_reason: boolean
  /** Short sentence, or null when there is nothing to say. */
  note: string | null
}

/** A driver judged for one booking (ADR-0017). */
export interface CandidateDriver extends Driver {
  dispatchable: boolean
  note: string | null
}
