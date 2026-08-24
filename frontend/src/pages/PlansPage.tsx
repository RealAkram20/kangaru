import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { formatUgx } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import { Badge } from '../components/core/Badge'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { PageFill } from '../components/layout/PageFill'

/**
 * What a fleet pays to be on Kangaru (ADR-0058).
 *
 * A plan is **rows, not code**, so this screen is a register rather than a
 * feature: adding a tier or grandfathering an operator is a data change, and
 * the catalogue shows what the data currently says.
 *
 * ## Unlimited is a word here, not a number
 *
 * A null limit means no ceiling. It is rendered as "Unlimited" rather than as
 * a dash or a large figure, because a dash reads as *unknown* and a figure
 * reads as *a ceiling you have not hit yet* — and Shanitah's Founding fleet
 * plan is genuinely uncapped.
 */
interface Plan {
  id: number
  slug: string
  name: string
  description: string | null
  is_default: boolean
  price_minor: number
  currency: string
  period: 'none' | 'monthly' | 'annual'
  driver_limit: number | null
  vehicle_limit: number | null
  staff_limit: number | null
  fleets_count?: number
}

const PERIOD: Record<Plan['period'], string> = {
  none: 'no charge',
  monthly: 'per month',
  annual: 'per year',
}

/** A ceiling, or the absence of one said as a word. */
function limit(value: number | null) {
  return value === null ? (
    <span style={{ color: 'var(--text-secondary)' }}>Unlimited</span>
  ) : (
    <span style={{ font: 'var(--type-identifier)' }}>{value}</span>
  )
}

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Plan[]>>('/plans')
      .then((response) => setPlans(response.data.data))
      .catch((caught: unknown) => setError(apiError(caught, 'Could not load the plans.').message))
  }, [])

  const columns = useMemo<DataColumn<Plan>[]>(
    () => [
      {
        key: 'name',
        card: 'title',
        header: 'Plan',
        render: (row) => (
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {row.name}
            {/* Free is a real plan and the default, not the absence of one. */}
            {row.is_default && <Badge tone="info">Default</Badge>}
          </span>
        ),
      },
      {
        key: 'price_minor',
        card: 'meta',
        header: 'Price',
        numeric: true,
        render: (row) => (
          <span>
            {row.price_minor === 0 ? 'Free' : formatUgx(row.price_minor)}
            <span style={{ color: 'var(--text-secondary)' }}> · {PERIOD[row.period]}</span>
          </span>
        ),
      },
      { key: 'driver_limit', card: 'meta', header: 'Drivers', numeric: true, render: (row) => limit(row.driver_limit) },
      { key: 'vehicle_limit', card: 'meta', header: 'Vehicles', numeric: true, render: (row) => limit(row.vehicle_limit) },
      { key: 'staff_limit', card: 'meta', header: 'Staff', numeric: true, render: (row) => limit(row.staff_limit) },
      {
        key: 'fleets_count',
        card: 'status',
        header: 'On this plan',
        numeric: true,
        render: (row) => <>{row.fleets_count ?? 0}</>,
      },
    ],
    [],
  )

  return (
    <PageFill>
      <PageFill.Flex>
        {error && <Alert tone="error">{error}</Alert>}

        <Card
          fill
          padding="none"
          title="Plans"
          subtitle={plans ? `${plans.length} on the platform` : undefined}
        >
          <DataTable<Plan>
            fill
            columns={columns}
            rows={plans ?? []}
            emptyMessage={plans === null ? 'Loading…' : 'No plans yet'}
          />
        </Card>
      </PageFill.Flex>
    </PageFill>
  )
}
