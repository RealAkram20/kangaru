import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { formatUgx } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { Company } from '../types/company'
import { Badge } from '../components/core/Badge'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Input } from '../components/forms/Input'

const STATUS_TONE: Record<Company['status'], 'success' | 'warning'> = {
  active: 'success',
  suspended: 'warning',
}

const COLUMNS: DataColumn<Company>[] = [
  { key: 'legal_name', header: 'Legal name', sortable: true },
  { key: 'trading_name', header: 'Trading name' },
  { key: 'city', header: 'City' },
  { key: 'country', header: 'Country' },
  {
    key: 'credit_limit_minor',
    header: 'Credit limit',
    numeric: true,
    sortable: true,
    render: (row) => formatUgx(row.credit_limit_minor),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
  },
]

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Company[]>>('/companies')
      .then((response) => setCompanies(response.data.data))
      .catch(() => setError('Could not load companies.'))
  }, [])

  const filtered = useMemo(() => {
    if (!companies) return []
    const q = query.trim().toLowerCase()
    if (!q) return companies
    return companies.filter(
      (c) =>
        c.legal_name.toLowerCase().includes(q) ||
        (c.trading_name?.toLowerCase().includes(q) ?? false) ||
        c.city.toLowerCase().includes(q),
    )
  }, [companies, query])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
        title="Companies"
        subtitle={companies ? `${companies.length} total` : undefined}
        actions={
          <Input
            iconLeft="search"
            placeholder="Filter by name or city"
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
          <DataTable<Company>
            columns={COLUMNS}
            rows={filtered}
            emptyMessage={
              companies === null ? 'Loading…' : query ? 'No companies match your filter' : 'No companies yet'
            }
          />
        )}
      </Card>
    </div>
  )
}
