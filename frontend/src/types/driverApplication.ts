/**
 * A rider who applied to drive (ADR-0027).
 *
 * Not an account and not a driver: until somebody approves it, this row is
 * the applicant's entire footprint on the platform. Approval creates the
 * driver profile and the login in one act.
 */
export interface DriverApplication {
  id: number
  name: string
  phone: string
  email: string
  status: 'pending' | 'approved' | 'rejected'
  status_label: string
  /**
   * When they accepted the Terms and Privacy notices — a time, not a
   * boolean, because that is what the Data Protection and Privacy Act, 2019
   * would want evidenced (ADR-0027 §5).
   */
  terms_accepted_at: string
  reviewed_at: string | null
  reviewed_by_user_id: number | null
  rejection_reason: string | null
  /** Set once approved, so the queue can link to the profile it produced. */
  driver_id: number | null
  created_at: string
}
