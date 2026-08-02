/** Matches the backend envelope in AGENTS.md API Standards. */
export interface ApiSuccess<T, M = undefined> {
  success: true
  message: string
  data: T
  meta?: M
}

export interface ApiError {
  success: false
  code: string
  message: string
  errors: Record<string, string[]>
}

/**
 * Whether a listing spans every client or is one client's (ADR-0006).
 *
 * Served by the endpoint, never inferred here. Shanitah's own staff belong
 * to no tenant and so read across all of them, and a UI that worked that
 * out for itself — by inspecting the signed-in user's `tenant_id`, say —
 * would be another copy of the predicate ADR-0006 exists to keep in one
 * place. `/audit-logs`, `/bookings` and `/trips` all report it.
 */
export type TenancyScope = 'platform' | 'tenant'

/** A cursor-paginated listing that also reports whose rows it contains. */
export interface ScopedCursorMeta {
  cursor: { next: string | null }
  scope: TenancyScope
}
