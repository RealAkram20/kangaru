import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import type { ApiSuccess } from '../types/api'
import type { Driver } from '../types/driver'
import { Badge } from '../components/core/Badge'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Input } from '../components/forms/Input'

const STATUS_TONE: Record<Driver['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  inactive: 'neutral',
}

const COLUMNS: DataColumn<Driver>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'phone', header: 'Phone' },
  { key: 'license_number', header: 'License number' },
  { key: 'license_expiry', header: 'License expiry', sortable: true },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
  },
]

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Driver[]>>('/drivers')
      .then((response) => setDrivers(response.data.data))
      .catch(() => setError('Could not load drivers.'))
  }, [])

  const filtered = useMemo(() => {
    if (!drivers) return []
    const q = query.trim().toLowerCase()
    if (!q) return drivers
    return drivers.filter(
      (d) => d.name.toLowerCase().includes(q) || d.license_number.toLowerCase().includes(q),
    )
  }, [drivers, query])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
        title="Drivers"
        subtitle={drivers ? `${drivers.length} total` : undefined}
        actions={
          <Input
            iconLeft="search"
            placeholder="Filter by name or license number"
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
          <DataTable<Driver>
            columns={COLUMNS}
            rows={filtered}
            emptyMessage={
              drivers === null ? 'Loading…' : query ? 'No drivers match your filter' : 'No drivers yet'
            }
          />
        )}
      </Card>
    </div>
  )
}
