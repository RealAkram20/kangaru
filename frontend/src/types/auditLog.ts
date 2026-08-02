import type { User } from './auth'

export type AuditAction = 'created' | 'updated' | 'deleted'

export interface AuditLogChanges {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface AuditLogEntry {
  id: number
  tenant_id: number | null
  user_id: number | null
  user: User | null
  auditable_type: string
  auditable_id: number
  action: AuditAction
  changes: AuditLogChanges
  ip_address: string | null
  created_at: string
}

export interface CursorMeta {
  cursor: {
    next: string | null
  }
}

/**
 * What `/audit-logs` will accept, served alongside the page.
 *
 * Held server-side deliberately: the whitelist was a hardcoded
 * `company|user` for long enough that filtering for a role change — the
 * mutation AGENTS.md names first — answered 422 against a table full of
 * them. A copy on the client is the same failure with an extra step.
 */
export interface AuditLogFilterOptions {
  /** Morph aliases: `company`, `role`, `invoice`, `vehicle_allocation`… */
  auditable_types: string[]
  actions: AuditAction[]
  /**
   * The people who appear in this reader's slice of the trail — not every
   * account that exists. Served rather than read from `/users`, because a
   * custom role holding `audit.view` without `staff.view` is refused there.
   */
  actors: { value: number; label: string }[]
}

export interface AuditLogMeta extends CursorMeta {
  filters: AuditLogFilterOptions
  /**
   * `platform` for a reader with no tenant, who sees every tenant's trail
   * plus the role changes that carry a null tenant_id; `tenant` for
   * everyone else, whose read is scoped and will never show those.
   */
  scope: 'platform' | 'tenant'
}
