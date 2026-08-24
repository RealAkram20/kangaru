import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { formatTimestamp } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type { User } from '../../types/auth'
import type { Operator } from '../../types/operator'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { KPIStat } from '../../components/data/KPIStat'
import { StatGrid } from '../../components/data/StatGrid'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { RouteFallback } from '../../components/feedback/RouteFallback'
import { ActAsDialog } from './ActAsDialog'
import { EditFleetDialog } from './EditFleetDialog'

/**
 * One fleet company (ADR-0055, ADR-0059).
 *
 * ## What this page is not
 *
 * It is not a window into the fleet. There are no trips here, no drivers by
 * name, no clients by name, no revenue — head office counts what a fleet has
 * and reads none of it (ADR-0055 §2). The way in is **Log in as**, which is
 * announced to the subject, time-boxed and recorded against both names.
 *
 * That is a stronger position than a register, not a weaker one: a
 * cross-fleet read is silent and unbounded, and an acting-as session answers
 * "why did this driver's job fail?" with the fleet's own dispatch board
 * rather than a row with no context around it.
 *
 * The accounts table is the one thing here that names people, and it exists
 * because acting as needs somebody to become.
 */
const ACCOUNT_COLUMNS: DataColumn<User>[] = [
  { key: 'name', card: 'title', header: 'Name', sortable: true },
  { key: 'email', card: 'meta', header: 'Email' },
  {
    key: 'role_label',
    card: 'meta',
    header: 'Role',
    render: (row) => <>{row.role_label ?? row.role}</>,
  },
  {
    key: 'status',
    card: 'status',
    header: 'Status',
    // Never colour alone — the badge carries the word (DESIGN.md, WCAG AA).
    render: (row) => (
      <Badge tone={row.status === 'suspended' ? 'warning' : 'success'}>
        {row.status ?? 'active'}
      </Badge>
    ),
  },
]

export function FleetRecordPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [fleet, setFleet] = useState<Operator | null>(null)
  const [accounts, setAccounts] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actingAs, setActingAs] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    apiClient
      .get<ApiSuccess<Operator>>(`/operators/${id}`)
      .then((response) => {
        setFleet(response.data.data)
        setError(null)
      })
      .catch((caught: unknown) => setError(apiError(caught, 'Could not load this fleet.').message))

    apiClient
      .get<ApiSuccess<User[]>>(`/operators/${id}/accounts`)
      .then((response) => setAccounts(response.data.data))
      .catch(() => setAccounts([]))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(status: Operator['status']) {
    setSaving(true)
    try {
      const response = await apiClient.patch<ApiSuccess<Operator>>(`/operators/${id}`, { status })
      setFleet(response.data.data)
      setConfirmSuspend(false)
    } catch (caught) {
      setError(apiError(caught, 'Could not change this fleet’s status.').message)
    } finally {
      setSaving(false)
    }
  }

  if (error !== null && fleet === null) {
    return (
      <Alert tone="error" action={<Button variant="secondary" onClick={() => navigate('/fleets')}>Back to fleets</Button>}>
        {error}
      </Alert>
    )
  }

  if (fleet === null) return <RouteFallback />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {error && <Alert tone="error">{error}</Alert>}

      <Card
        title={fleet.name}
        subtitle={fleet.created_at ? `On Kangaru since ${formatTimestamp(fleet.created_at)}` : undefined}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={fleet.is_active ? 'success' : 'warning'}>{fleet.status}</Badge>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setActingAs(true)}>
              Log in as
            </Button>
            {fleet.is_active ? (
              <Button variant="destructive" onClick={() => setConfirmSuspend(true)}>
                Suspend
              </Button>
            ) : (
              <Button variant="secondary" disabled={saving} onClick={() => void setStatus('active')}>
                Reinstate
              </Button>
            )}
          </span>
        }
      >
        <StatGrid aria-label="This fleet at a glance">
          <KPIStat label="Drivers" value={fleet.drivers_count ?? '—'} icon="users" />
          <KPIStat label="Vehicles" value={fleet.vehicles_count ?? '—'} icon="truck" />
          <KPIStat label="Corporate clients" value={fleet.clients_count ?? '—'} icon="building-2" />
          <KPIStat label="Accounts" value={fleet.users_count ?? '—'} icon="user-cog" />
          <KPIStat label="Plan" value={fleet.plan?.name ?? '—'} icon="tags" />
        </StatGrid>
      </Card>

      <Card
        title="Accounts"
        subtitle="Who support can act as here"
        padding="none"
      >
        <DataTable<User>
          columns={ACCOUNT_COLUMNS}
          rows={accounts ?? []}
          emptyMessage={accounts === null ? 'Loading…' : 'No accounts at this fleet'}
        />
      </Card>

      {actingAs && <ActAsDialog fleet={fleet} onClose={() => setActingAs(false)} />}

      {editing && (
        <EditFleetDialog
          fleet={fleet}
          onClose={() => setEditing(false)}
          onDone={(saved) => {
            setEditing(false)
            setFleet(saved)
          }}
        />
      )}

      {confirmSuspend && (
        <Dialog
          title={`Suspend ${fleet.name}?`}
          tone="destructive"
          onClose={() => setConfirmSuspend(false)}
          description="They stop being offered work. Their trips, invoices and drivers are untouched."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmSuspend(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={saving} onClick={() => void setStatus('suspended')}>
                {saving ? 'Suspending…' : 'Suspend fleet'}
              </Button>
            </>
          }
        />
      )}
    </div>
  )
}
