import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/apiClient'
import type { ApiSuccess } from '../types/api'
import type { Operator } from '../types/operator'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { Input } from '../components/forms/Input'
import { PageFill } from '../components/layout/PageFill'
import { OnboardFleetDialog } from './fleets/OnboardFleetDialog'

/**
 * The register of fleet companies (ADR-0055, ADR-0059).
 *
 * Head office's, and nobody else's. This is the first screen for the axis
 * ADR-0055 added a month of migrations for and never rendered — until it
 * existed, `docs/fleet-model-plan.md` §4b's blocker number one stood: there
 * was no way to create an operator, so a second fleet could not exist.
 *
 * Counts, never operational data. The four numbers here are what head office
 * is entitled to know about a fleet; to look at any of it, act as somebody
 * there. The Log in as button lives on the record page, where you can see who
 * you would become.
 */
const STATUS_TONE: Record<Operator['status'], 'success' | 'warning'> = {
  active: 'success',
  suspended: 'warning',
}

export function FleetCompaniesPage() {
  const navigate = useNavigate()
  const [fleets, setFleets] = useState<Operator[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onboarding, setOnboarding] = useState(false)

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<Operator[]>>('/operators')
        .then((response) => {
          setFleets(response.data.data)
          setError(null)
        })
        .catch(() => setError('Could not load fleet companies.')),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo<DataColumn<Operator>[]>(
    () => [
      { key: 'name', card: 'title', header: 'Fleet', sortable: true },
      {
        key: 'plan',
        card: 'meta',
        header: 'Plan',
        render: (row) => <>{row.plan?.name ?? '—'}</>,
      },
      { key: 'drivers_count', card: 'meta', header: 'Drivers', numeric: true, sortable: true },
      { key: 'vehicles_count', card: 'meta', header: 'Vehicles', numeric: true, sortable: true },
      { key: 'clients_count', card: 'meta', header: 'Clients', numeric: true, sortable: true },
      {
        key: 'status',
        card: 'status',
        header: 'Status',
        // Never colour alone (DESIGN.md, WCAG AA): the badge carries the word.
        render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
      },
    ],
    [],
  )

  const filtered = useMemo(() => {
    if (!fleets) return []
    const q = query.trim().toLowerCase()
    if (!q) return fleets
    return fleets.filter((f) => f.name.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q))
  }, [fleets, query])

  return (
    <PageFill>
      <PageFill.Flex>
        {error && <Alert tone="error">{error}</Alert>}

        <Card
          fill
          padding="none"
          title="Fleet companies"
          subtitle={fleets ? `${fleets.length} on the platform` : undefined}
          actions={
            <span
              style={{
                display: 'inline-flex',
                gap: 'var(--space-3)',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              <Input
                iconLeft="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name"
                aria-label="Filter fleet companies by name"
              />
              <Button onClick={() => setOnboarding(true)}>Onboard fleet</Button>
            </span>
          }
        >
          {fleets !== null && fleets.length === 0 ? (
            <EmptyState
              icon="building-2"
              title="No fleet companies yet"
              action={<Button onClick={() => setOnboarding(true)}>Onboard fleet</Button>}
            />
          ) : (
            <DataTable<Operator>
              fill
              columns={columns}
              rows={filtered}
              onRowClick={(row) => navigate(`/fleets/${row.id}`)}
              emptyMessage={fleets === null ? 'Loading…' : 'No fleet matches that filter'}
            />
          )}
        </Card>
      </PageFill.Flex>

      {onboarding && (
        <OnboardFleetDialog
          onClose={() => setOnboarding(false)}
          onDone={(fleet) => {
            setOnboarding(false)
            navigate(`/fleets/${fleet.id}`)
          }}
        />
      )}
    </PageFill>
  )
}
