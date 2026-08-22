export interface User {
  id: number
  tenant_id: number | null
  /**
   * The tenant's display name — "Centenary Bank" — or null for platform
   * staff, who have none (ADR-0006). The chrome names whose console this is
   * from here rather than by fetching `/companies`. Optional so a response
   * from an API older than the field still types.
   */
  tenant_name?: string | null
  /**
   * Which of the levels this account belongs to (App\Enums\AccessLevel,
   * ADR-0055 §4) — `kangaru`, `fleet`, `client` or `applicant`.
   *
   * The menu is chosen by this before role narrows it (ADR-0059 §1). Stated
   * on the row and never worked out from `tenant_id` and `operator_id` being
   * null: inference would have promoted six accounts to head office silently.
   *
   * Optional because a response from an API older than the field still types.
   * `menuFor` treats an absent level as `fleet` rather than as nothing — see
   * the note there for why that exception to failing closed is the safe
   * direction in this one place.
   */
  access_level?: 'kangaru' | 'fleet' | 'client' | 'applicant'
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
  /**
   * The switches a client's administrator set on this account
   * (App\Enums\ClientCapability), unioned onto the role's permissions
   * server-side. The menu reads them so a Corporate Employee who may see
   * invoices is offered the door. Optional: an older API sends none.
   */
  capabilities?: string[]
  books_without_approval?: boolean
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
