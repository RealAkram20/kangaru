import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { apiClient } from '../lib/apiClient'
import { isCorporateRole } from '../lib/navigation'
import { formatUgx } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { Company } from '../types/company'
import { Badge } from '../components/core/Badge'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Input } from '../components/forms/Input'
import { PageFill } from '../components/layout/PageFill'
import { OrganisationView } from './companies/OrganisationView'

const STATUS_TONE: Record<Company['status'], 'success' | 'warning'> = {
  active: 'success',
  suspended: 'warning',
}

const COLUMNS: DataColumn<Company>[] = [
  { key: 'legal_name', card: 'title', header: 'Legal name', sortable: true },
  { key: 'trading_name', card: 'meta', header: 'Trading name' },
  { key: 'city', card: 'meta', header: 'City' },
  { key: 'country', card: 'meta', header: 'Country' },
  {
    key: 'credit_limit_minor',
    card: 'meta',
    header: 'Credit limit',
    numeric: true,
    sortable: true,
    render: (row) => formatUgx(row.credit_limit_minor),
  },
  {
    key: 'status',
    card: 'status',
    header: 'Status',
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
  },
]

/**
 * The operator's register of corporate clients — or, to a client's own
 * administrator, the page about their organisation. Same route, same
 * `/companies` (which the scope narrows to their one row), a different
 * page: a bank does not read itself as a one-line entry in somebody
 * else's register.
 */
export function CompaniesPage() {
  const { user } = useAuth()

  if (isCorporateRole(user?.role)) return <OrganisationView />

  return <CompanyRegister />
}

function CompanyRegister() {
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
    <PageFill>
      <PageFill.Flex>
      <Card
        fill
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
            fill
            emptyMessage={
              companies === null ? 'Loading…' : query ? 'No companies match your filter' : 'No companies yet'
            }
          />
        )}
      </Card>
      </PageFill.Flex>
    </PageFill>
  )
}
