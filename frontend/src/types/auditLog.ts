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
