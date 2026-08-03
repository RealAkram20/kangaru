export interface User {
  id: number
  tenant_id: number | null
  name: string
  email: string
  role: string
  /**
   * The role's display name — "Corporate Admin", not "corporate_admin".
   *
   * `UserResource` has always sent it and this type never declared it, so
   * every surface showing a role rendered the raw slug. Optional because a
   * user whose `users.role` matches no row resolves to none (ADR-0004 fails
   * closed), and callers fall back to `role`.
   */
  role_label?: string
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
