import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import type { ApiSuccess } from '../types/api'
import type { Vehicle } from '../types/vehicle'
import { Badge } from '../components/core/Badge'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Input } from '../components/forms/Input'
import { PageFill } from '../components/layout/PageFill'

const STATUS_TONE: Record<Vehicle['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  maintenance: 'warning',
  inactive: 'neutral',
}

const COLUMNS: DataColumn<Vehicle>[] = [
  { key: 'registration_number', card: 'title', header: 'Reg. number', sortable: true },
  { key: 'make', card: 'meta', header: 'Make' },
  { key: 'model', card: 'meta', header: 'Model' },
  { key: 'year', card: 'meta', header: 'Year', numeric: true, sortable: true },
  { key: 'category', card: 'meta', header: 'Category' },
  { key: 'seating_capacity', card: 'meta', header: 'Seats', numeric: true },
  {
    key: 'status',
    card: 'status',
    header: 'Status',
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
  },
]

export function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Vehicle[]>>('/vehicles')
      .then((response) => setVehicles(response.data.data))
      .catch(() => setError('Could not load vehicles.'))
  }, [])

  const filtered = useMemo(() => {
    if (!vehicles) return []
    const q = query.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter(
      (v) =>
        v.registration_number.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q),
    )
  }, [vehicles, query])

  return (
    <PageFill>
      <PageFill.Flex>
      <Card
        fill
        title="Vehicles"
        subtitle={vehicles ? `${vehicles.length} total` : undefined}
        actions={
          <Input
            iconLeft="search"
            placeholder="Filter by reg. number, make or model"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 260 }}
          />
        }
        padding="none"
      >
        {error ? (
          <p style={{ padding: 'var(--space-6)', color: 'var(--kr-error)' }}>{error}</p>
        ) : (
          <DataTable<Vehicle>
            columns={COLUMNS}
            rows={filtered}
            fill
            emptyMessage={
              vehicles === null ? 'Loading…' : query ? 'No vehicles match your filter' : 'No vehicles yet'
            }
          />
        )}
      </Card>
      </PageFill.Flex>
    </PageFill>
  )
}
