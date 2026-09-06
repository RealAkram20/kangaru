import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import { Badge } from '../../components/core/Badge'
import { Card } from '../../components/core/Card'
import { KPIStat } from '../../components/data/KPIStat'
import { StatGrid } from '../../components/data/StatGrid'
import { Alert } from '../../components/feedback/Alert'

/**
 * Head office's dashboard (ADR-0059, `K4`).
 *
 * Counts, and deliberately nothing else. There is no trip here, no booking,
 * no driver by name — ADR-0055 §2 leaves no account able to read every
 * fleet's data in one query, Super Admin included. What replaces it is the
 * network, the work only head office can clear, and who is currently acting
 * as whom.
 *
 * The dashboard it replaced showed three company counters and the audit log,
 * which was both thin and, after ADR-0055, aimed at data this level no longer
 * reads.
 */
interface Overview {
  network: {
    fleets: number
    fleets_active: number
    clients: number
    walk_in_clients: number
    drivers: number
    vehicles: number
  }
  queues: {
    driver_applications: number
    driver_reports: number
    settlement_requests: number
    fleets_without_an_account: number
  }
  governance: { acting_as_now: number; kangaru_staff: number }
}

/** A queue row: what it is, how many, and where clearing it happens. */
function Queue({
  label,
  count,
  to,
  tone = 'default',
}: {
  label: string
  count: number
  to?: string
  tone?: 'default' | 'alarm'
}) {
  const navigate = useNavigate()
  const clickable = to !== undefined && count > 0

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: clickable ? 'pointer' : undefined,
      }}
      onClick={clickable ? () => navigate(to) : undefined}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') navigate(to)
            }
          : undefined
      }
    >
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {tone === 'alarm' && count > 0 ? (
        <Badge tone="error">{count}</Badge>
      ) : (
        <span style={{ font: 'var(--type-identifier)', color: count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {count}
        </span>
      )}
    </div>
  )
}

export function KangaruDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Overview>>('/kangaru/overview')
      .then((response) => setOverview(response.data.data))
      .catch((caught: unknown) => setError(apiError(caught, 'Could not load the overview.').message))
  }, [])

  if (error !== null) return <Alert tone="error">{error}</Alert>

  const n = overview?.network
  const q = overview?.queues
  const g = overview?.governance
  const dash = '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <StatGrid aria-label="The network at a glance">
        <KPIStat
          label="Fleet companies"
          value={n?.fleets ?? dash}
          icon="building-2"
          hint={n ? `${n.fleets_active} active` : undefined}
        />
        <KPIStat label="Corporate clients" value={n?.clients ?? dash} icon="briefcase" />
        <KPIStat label="Walk-in clients" value={n?.walk_in_clients ?? dash} icon="contact" />
        <KPIStat label="Drivers" value={n?.drivers ?? dash} icon="users" />
        <KPIStat label="Vehicles" value={n?.vehicles ?? dash} icon="truck" />
      </StatGrid>

      <div
        style={{
          display: 'grid',
          gap: 'var(--space-6)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <Card title="Needs head office" padding="none">
          <Queue label="Driver applications" count={q?.driver_applications ?? 0} to="/driver-applications" />
          <Queue label="Driver reports" count={q?.driver_reports ?? 0} to="/support-requests" />
          <Queue label="Settlement requests" count={q?.settlement_requests ?? 0} />
          {/*
            Shown even at nought, unlike the rows above, because nought is the
            answer that means the invariant holds. A fleet with no account is
            unreachable to support for ever (ADR-0059 §5).
          */}
          <Queue
            label="Fleets with nobody to act as"
            count={q?.fleets_without_an_account ?? 0}
            tone="alarm"
            to="/fleets"
          />
        </Card>

        <Card title="Governance" padding="none">
          <Queue label="Acting as somebody, right now" count={g?.acting_as_now ?? 0} to="/audit-log" />
          <Queue label="Kangaru staff accounts" count={g?.kangaru_staff ?? 0} to="/staff" />
        </Card>
      </div>
    </div>
  )
}
