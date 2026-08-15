/**
 * A driver's papers (ADR-0033).
 *
 * Hand-transcribed from `docs/api/openapi.yaml` like every other type here.
 */
export type DriverDocumentType =
  | 'driving_licence'
  | 'identity_document'
  | 'vehicle_insurance'
  | 'vehicle_registration'

/** The three **stored** states. `expired` is not one — see `compliance_state`. */
export type DriverDocumentStatus = 'pending' | 'verified' | 'rejected'

/**
 * The state to act on: the stored status, plus the derived `expired`.
 *
 * **Expiry outranks verification.** A verified licence past its date reports
 * `expired`, while `status` still says `verified` because nothing wrote to the
 * row. Any screen reading `status` instead of this one would tell an office
 * that a lapsed licence is in order.
 */
export type DriverDocumentComplianceState = DriverDocumentStatus | 'expired'

export interface DriverDocument {
  id: number
  driver_id: number
  type: DriverDocumentType
  type_label: string
  status: DriverDocumentStatus
  status_label: string
  compliance_state: DriverDocumentComplianceState
  expires_at: string | null
  expired: boolean
  original_name: string | null
  mime_type: string
  size_bytes: number
  uploaded_at: string
  rejection_reason: string | null
  reviewed_at: string | null
  /** A route path, never a storage URL. Fetched with the session's bearer. */
  file_url: string
}

/**
 * One document type and whatever is held against it.
 *
 * **`document` is null for a type never uploaded**, and the office needs those
 * rows as much as the driver does: "what is this person missing" is the
 * question a reviewer arrives with.
 */
export interface DriverDocumentSlot {
  type: DriverDocumentType
  type_label: string
  hint: string
  requires_expiry: boolean
  document: DriverDocument | null
}

export interface DriverDocumentCompliance {
  state: 'verified' | 'pending' | 'incomplete' | 'action_needed'
  verified: number
  total: number
  action_needed: number
  pending: number
}
