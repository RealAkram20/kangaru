export interface User {
  id: number
  tenant_id: number | null
  name: string
  email: string
  role: string
  created_at: string
  /**
   * Whether this account has a second factor set up (ADR-0008).
   *
   * Optional so a response from an API older than the decision still types.
   */
  mfa_enabled?: boolean
  /**
   * Whether this account must enrol before it can do anything else.
   *
   * Served by the API rather than worked out from `role`: which roles need
   * a factor is a server rule, and a client holding its own copy of it
   * would be deciding whether a control is enforced.
   */
  must_enrol_mfa?: boolean
}
