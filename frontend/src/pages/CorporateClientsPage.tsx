import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'
import type { Company } from '../types/company'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { Input } from '../components/forms/Input'
import { PageFill } from '../components/layout/PageFill'
import { OnboardClientDialog } from './clients/OnboardClientDialog'

/**
 * Head office's directory of corporate clients (ADR-0062).
 *
 * ## What is deliberately not here
 *
 * No bookings, no trips, no invoices, no staff, no credit limit. ADR-0062
 * moved the line from *how much* Kangaru reads to *what kind*: the directory
 * is the network, and the network is Kangaru's business — the operations
 * belong to the fleet serving them, and are reached by acting as somebody
 * there.
 *
 * A credit limit is the sharpest example of the line, because the column is
 * right there on the contract: it is a fleet's own judgement about its
 * customer's creditworthiness, and head office is not a party to it.
 *
 * This screen replaces the count on `K4`'s dashboard, which could not survive
 * head office being able to onboard a client and then unable to see the one it
 * had just created.
 */
const STATUS_TONE: Record<Company['status'], 'success' | 'warning'> = {
  active: 'success',
  suspended: 'warning',
}

export function CorporateClientsPage() {
  const [clients, setClients] = useState<Company[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onboarding, setOnboarding] = useState(false)

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<Company[]>>('/companies')
        .then((response) => {
          setClients(response.data.data)
          setError(null)
        })
        .catch((caught: unknown) => setError(apiError(caught, 'Could not load the client directory.').message)),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo<DataColumn<Company>[]>(
    () => [
      { key: 'legal_name', card: 'title', header: 'Client', sortable: true },
      { key: 'trading_name', card: 'meta', header: 'Trading as' },
      {
        key: 'registration_number',
        card: 'meta',
        header: 'Registration',
        // The platform-wide identity of a client (ADR-0060 §1). Mono, like
        // every other reference in this console.
        render: (row) => (
          <span style={{ font: 'var(--type-identifier)' }}>{row.registration_number ?? '—'}</span>
        ),
      },
      { key: 'city', card: 'meta', header: 'City' },
      {
        key: 'status',
        card: 'status',
        header: 'Status',
        render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
      },
    ],
    [],
  )

  const filtered = useMemo(() => {
    if (!clients) return []
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(
      (c) =>
        c.legal_name.toLowerCase().includes(q) ||
        (c.trading_name ?? '').toLowerCase().includes(q) ||
        (c.registration_number ?? '').toLowerCase().includes(q),
    )
  }, [clients, query])

  return (
    <PageFill>
      <PageFill.Flex>
        {error && <Alert tone="error">{error}</Alert>}

        <Card
          fill
          padding="none"
          title="Corporate clients"
          subtitle={clients ? `${clients.length} on the platform` : undefined}
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
                placeholder="Filter by name or registration"
                aria-label="Filter corporate clients"
              />
              <Button onClick={() => setOnboarding(true)}>Onboard client</Button>
            </span>
          }
        >
          {clients !== null && clients.length === 0 ? (
            <EmptyState
              icon="briefcase"
              title="No corporate clients yet"
              action={<Button onClick={() => setOnboarding(true)}>Onboard client</Button>}
            />
          ) : (
            <DataTable<Company>
              fill
              columns={columns}
              rows={filtered}
              emptyMessage={clients === null ? 'Loading…' : 'No client matches that filter'}
            />
          )}
        </Card>
      </PageFill.Flex>

      {onboarding && (
        <OnboardClientDialog
          onClose={() => setOnboarding(false)}
          onDone={() => {
            setOnboarding(false)
            void load()
          }}
        />
      )}
    </PageFill>
  )
}
