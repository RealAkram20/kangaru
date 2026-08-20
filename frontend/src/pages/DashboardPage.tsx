import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { apiClient } from '../lib/apiClient'
import { isCorporateRole } from '../lib/navigation'
import { formatRelativeTime, formatTimestamp, formatUgx } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { AuditAction, AuditLogEntry, CursorMeta } from '../types/auditLog'
import type { Company } from '../types/company'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { KPIStat } from '../components/data/KPIStat'
import { StatGrid } from '../components/data/StatGrid'
import { ClientDashboard } from './dashboard/ClientDashboard'

const ACTION_TONE: Record<AuditAction, 'success' | 'info' | 'error'> = {
  created: 'success',
  updated: 'info',
  deleted: 'error',
}

const AUDIT_COLUMNS: DataColumn<AuditLogEntry>[] = [
  { key: 'user', header: 'Actor', render: (row) => row.user?.name ?? 'System' },
  {
    key: 'action',
    header: 'Action',
    render: (row) => <Badge tone={ACTION_TONE[row.action]}>{row.action}</Badge>,
  },
  {
    key: 'auditable_type',
    header: 'Entity',
    render: (row) => `${row.auditable_type} #${row.auditable_id}`,
  },
  {
    key: 'created_at',
    header: 'When',
    render: (row) => <span style={{ font: 'var(--type-identifier)' }}>{formatTimestamp(row.created_at)}</span>,
  },
]

/** Mirrors AuditLogPolicy::viewAny() exactly — avoids firing a request
 * (and a console 403) for a role the backend would deny anyway. */
function canViewAuditLog(role: string | undefined): boolean {
  return role === 'super_admin' || role === 'corporate_admin'
}

/**
 * Two dashboards behind one route. A corporate client's user — a bank's
 * transport officer, or the member of staff who requests a car — gets
 * their own trips, bookings and invoicing (`ClientDashboard`); the operator's
 * roles get the platform view below. Branched on role here rather than by
 * two routes, because "the dashboard" is one place in everyone's head and
 * the URL should not say which kind of person you are.
 */
export function DashboardPage() {
  const { user } = useAuth()

  if (isCorporateRole(user?.role)) return <ClientDashboard />

  return <PlatformDashboard />
}

function PlatformDashboard() {
  const { user } = useAuth()
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const showAuditLog = canViewAuditLog(user?.role)

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Company[]>>('/companies')
      .then((response) => setCompanies(response.data.data))
      .catch(() => setCompanies([]))
  }, [])

  useEffect(() => {
    if (!showAuditLog) return
    apiClient
      .get<ApiSuccess<AuditLogEntry[], CursorMeta>>('/audit-logs')
      .then((response) => {
        setAuditEntries(response.data.data)
        setNextCursor(response.data.meta?.cursor.next ?? null)
      })
      .catch(() => setAuditEntries([]))
  }, [showAuditLog])

  function loadMoreAuditEntries() {
    if (!nextCursor) return
    setLoadingMore(true)
    apiClient
      .get<ApiSuccess<AuditLogEntry[], CursorMeta>>('/audit-logs', { params: { cursor: nextCursor } })
      .then((response) => {
        setAuditEntries((existing) => [...(existing ?? []), ...response.data.data])
        setNextCursor(response.data.meta?.cursor.next ?? null)
      })
      .finally(() => setLoadingMore(false))
  }

  const stats = useMemo(() => {
    if (!companies) return null
    const active = companies.filter((c) => c.status === 'active').length
    return {
      total: companies.length,
      active,
      suspended: companies.length - active,
      sumCreditLimitMinor: companies.reduce((sum, c) => sum + c.credit_limit_minor, 0),
    }
  }, [companies])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <StatGrid aria-label="Companies at a glance">
        <KPIStat
          label="Companies"
          value={stats?.total ?? '—'}
          icon="building-2"
          hint={stats ? `${stats.active} active · ${stats.suspended} suspended` : undefined}
        />
        <KPIStat
          label="Active companies"
          value={stats?.active ?? '—'}
          unit={stats ? `/ ${stats.total}` : undefined}
          icon="circle-check"
        />
        <KPIStat
          wide
          tone="accent"
          label="Aggregate credit limit"
          value={stats ? formatUgx(stats.sumCreditLimitMinor) : '—'}
          icon="receipt"
          hint={stats ? `Across ${stats.total} companies` : undefined}
        />
      </StatGrid>

      {showAuditLog && (
        <Card
          title="Recent activity"
          subtitle={auditEntries && auditEntries[0] ? `Last activity ${formatRelativeTime(auditEntries[0].created_at)}` : undefined}
          padding="none"
        >
          <DataTable<AuditLogEntry>
            columns={AUDIT_COLUMNS}
            rows={auditEntries ?? []}
            emptyMessage={auditEntries === null ? 'Loading…' : 'No audit activity yet'}
          />
          {nextCursor && (
            <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
              <Button variant="secondary" onClick={loadMoreAuditEntries} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
