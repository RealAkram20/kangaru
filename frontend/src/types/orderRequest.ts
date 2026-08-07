/**
 * A walk-in order request (ADR-0012) — somebody asking for a ride,
 * delivery or self-drive rental, before it becomes a booking.
 *
 * Lived inside `OrderRequestsPage` as a local `OrderRequestRow` until the
 * customer register (ADR-0018) needed the same shape for a customer's
 * order history. Two copies of a server contract drift in exactly the way
 * the OpenAPI census exists to stop, so it moved here rather than being
 * pasted.
 */
export interface OrderRequest {
  id: number
  reference: string
  service_type: string
  status: string
  allowed_transitions: string[]
  contact_name: string
  contact_phone: string
  contact_email: string | null
  pickup_location: string | null
  dropoff_location: string | null
  scheduled_for: string | null
  details: Record<string, string | number> | null
  notes: string | null
  dispatcher_notes: string | null
  handled_by: { id: number; name: string } | null
  created_at: string
}
