/**
 * A customer as staff see them (ADR-0018) — the platform's own retail
 * account holders, distinct from a corporate client's staff in `/users`.
 *
 * Never carries a credential. `has_password` / `has_google` say *how* the
 * person signs in, which is the first thing a support agent needs on "I
 * cannot log in" (ADR-0013 §3), without saying what the credential is.
 */
export interface CustomerProfile {
  id: number
  first_name: string
  last_name: string
  /** Composed server-side so four clients cannot spell the join four ways. */
  name: string
  gender: string | null
  phone: string
  email: string | null
  status: 'active' | 'suspended'
  has_password: boolean
  has_google: boolean
  suspended_at: string | null
  suspension_reason: string | null
  /** Only present on the single-customer read, which counts them. */
  orders_count?: number
  created_at: string
  updated_at: string
}

/** The register's header counts, sent with the page rather than separately. */
export interface CustomerTally {
  total: number
  active: number
  suspended: number
}
