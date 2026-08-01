import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import type { ApiSuccess } from '../types/api'
import type { Vehicle } from '../types/vehicle'
import { Badge } from '../components/core/Badge'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Input } from '../components/forms/Input'

const STATUS_TONE: Record<Vehicle['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  maintenance: 'warning',
  inactive: 'neutral',
}

const COLUMNS: DataColumn<Vehicle>[] = [
  { key: 'registration_number', header: 'Reg. number', sortable: true },
  { key: 'make', header: 'Make' },
  { key: 'model', header: 'Model' },
  { key: 'year', header: 'Year', numeric: true, sortable: true },
  { key: 'category', header: 'Category' },
  { key: 'seating_capacity', header: 'Seats', numeric: true },
  {
    key: 'status',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
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
            emptyMessage={
              vehicles === null ? 'Loading…' : query ? 'No vehicles match your filter' : 'No vehicles yet'
            }
          />
        )}
      </Card>
    </div>
  )
}
