import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Identifier } from '../components/core/Identifier'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { KPIStat } from '../components/data/KPIStat'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { canManageBilling } from '../lib/billing'
import { formatTimestamp, formatUgx } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { Invoice } from '../types/billing'
import type { CursorMeta } from '../types/trip'
import { CreditNoteDialog } from './billing/CreditNoteDialog'
import { InvoiceDetail } from './billing/InvoiceDetail'

/** DataTable keys rows off `id`; an invoice's external key is its uuid. */
type InvoiceRow = Invoice & { id: string }

const COLUMNS: DataColumn<InvoiceRow>[] = [
  {
    key: 'invoice_number',
    header: 'Invoice',
    render: (row) => <Identifier size="xs">{row.invoice_number}</Identifier>,
  },
  {
    key: 'trip_id',
    header: 'Trip',
    render: (row) => <Identifier size="xs">#{row.trip_id}</Identifier>,
  },
  { key: 'issued_at', header: 'Issued', render: (row) => formatTimestamp(row.issued_at) },
  {
    key: 'total_minor',
    header: 'Invoiced',
    numeric: true,
    render: (row) => formatUgx(row.total_minor),
  },
  {
    key: 'credited_minor',
    header: 'Credited',
    numeric: true,
    render: (row) =>
      row.credited_minor === 0 ? (
        '—'
      ) : (
        <span style={{ color: 'var(--kr-error)' }}>−{formatUgx(row.credited_minor)}</span>
      ),
  },
  {
    key: 'balance_minor',
    header: 'Balance',
    numeric: true,
    render: (row) => (
      <span style={{ fontWeight: 'var(--weight-medium)' }}>{formatUgx(row.balance_minor)}</span>
    ),
  },
  {
    key: 'uuid',
    header: 'State',
    render: (row) => {
      // There is no invoice status column and no payments module, so the
      // only distinction an invoice can honestly draw is how much of it has
      // been credited back. Anything richer would be invented.
      if (row.balance_minor === 0) {
        return (
          <Badge tone="neutral" size="sm" icon="circle-slash">
            Fully credited
          </Badge>
        )
      }

      return row.credited_minor > 0 ? (
        <Badge tone="warning" size="sm" icon="receipt-text">
          Part credited
        </Badge>
      ) : (
        <Badge tone="success" size="sm" icon="circle-check">
          Issued
        </Badge>
      )
    },
  },
]

interface Filters {
  from: string
  to: string
  invoice_number: string
}

function toQuery(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams()
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.invoice_number) params.set('invoice_number', filters.invoice_number)
  if (cursor) params.set('cursor', cursor)

  return params.toString()
}

export function InvoicesPage() {
  const { user } = useAuth()
  const [filters, setFilters] = useState<Filters>({ from: '', to: '', invoice_number: '' })
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [crediting, setCrediting] = useState<Invoice | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Bumped after a credit note lands so the open detail panel re-fetches.
  const [refreshToken, setRefreshToken] = useState(0)

  const load = useCallback(
    async (next: Filters, cursor: string | null) => {
      try {
        const response = await apiClient.get<ApiSuccess<Invoice[], CursorMeta>>(
          `/invoices?${toQuery(next, cursor)}`,
        )

        setInvoices((current) =>
          cursor === null ? response.data.data : [...(current ?? []), ...response.data.data],
        )
        setNextCursor(response.data.meta?.cursor.next ?? null)
        setError(null)
        setForbidden(false)
      } catch (failure) {
        const problem = apiError(failure, 'Could not load invoices.')
        // A role that cannot see invoices at all gets an explanation
        // rather than a red error it can do nothing about.
        if (problem.code === 'FORBIDDEN') {
          setForbidden(true)
          setInvoices([])
          return
        }
        setError(problem.message)
      }
    },
    [],
  )

  // Written as a promise chain rather than `void load(...)` so the state
  // updates land in a callback: setState straight from an effect body
  // cascades renders. Runs once — later changes go through Apply filters,
  // so a half-typed date range does not fire a query on every keystroke.
  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<Invoice[], CursorMeta>>('/invoices')
      .then((response) => {
        if (cancelled) return
        setInvoices(response.data.data)
        setNextCursor(response.data.meta?.cursor.next ?? null)
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        const problem = apiError(failure, 'Could not load invoices.')
        if (problem.code === 'FORBIDDEN') {
          setForbidden(true)
          setInvoices([])
          return
        }
        setError(problem.message)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const apply = () => {
    setInvoices(null)
    setSelected(null)
    void load(filters, null)
  }

  const loadMore = async () => {
    setLoadingMore(true)
    await load(filters, nextCursor)
    setLoadingMore(false)
  }

  const totals = (invoices ?? []).reduce(
    (carry, invoice) => ({
      invoiced: carry.invoiced + invoice.total_minor,
      credited: carry.credited + invoice.credited_minor,
      balance: carry.balance + invoice.balance_minor,
    }),
    { invoiced: 0, credited: 0, balance: 0 },
  )

  if (forbidden) {
    return (
      <EmptyState
        icon="lock"
        title="Invoices are not visible to your role"
        description="Restricted to Finance and administrators. Ask for access."
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Invoices" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" title="Credit note issued" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card title="Invoices" subtitle="One invoice per completed trip. Issued invoices are never edited.">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 'var(--space-4)',
            alignItems: 'end',
          }}
        >
          <FormField label="Issued from" htmlFor="i-from">
            <Input
              id="i-from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </FormField>
          <FormField label="Issued to" htmlFor="i-to">
            <Input
              id="i-to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </FormField>
          <FormField label="Invoice number" htmlFor="i-number">
            <Input
              id="i-number"
              placeholder="INV-2026-000001"
              mono
              value={filters.invoice_number}
              onChange={(e) => setFilters({ ...filters, invoice_number: e.target.value })}
            />
          </FormField>
          <div style={{ display: 'flex', gap: 'var(--gap-inline)' }}>
            <Button iconLeft="filter" onClick={apply}>
              Apply filters
            </Button>
          </div>
        </div>
      </Card>

      {invoices !== null && invoices.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <KPIStat label="Invoices shown" value={invoices.length.toLocaleString('en-US')} icon="receipt" />
          <KPIStat label="Invoiced" value={formatUgx(totals.invoiced)} icon="banknote" />
          <KPIStat label="Credited" value={formatUgx(totals.credited)} icon="receipt-text" />
          <KPIStat
            label="Outstanding"
            value={formatUgx(totals.balance)}
            icon="wallet"
            // Payments are not built, so this is issued-less-credited, not
            // what is actually unpaid. Saying so beats implying otherwise.
            hint="Less credit notes. Payments are not recorded yet."
          />
        </div>
      )}

      <Card padding="none">
        {invoices !== null && invoices.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="No invoices yet"
            description="Raised from a completed trip, on the Trips page."
          />
        ) : (
          <DataTable<InvoiceRow>
            columns={COLUMNS}
            rows={(invoices ?? []).map((invoice) => ({ ...invoice, id: invoice.uuid }))}
            dense
            onRowClick={(row) => setSelected((current) => (current === row.uuid ? null : row.uuid))}
            emptyMessage={invoices === null ? 'Loading…' : 'No invoices match these filters'}
          />
        )}
        {nextCursor && (
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
            <Button size="sm" variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        )}
      </Card>

      {selected && (
        <InvoiceDetail
          key={selected}
          uuid={selected}
          refreshToken={refreshToken}
          canCredit={canManageBilling(user)}
          onClose={() => setSelected(null)}
          onCreditNote={setCrediting}
        />
      )}

      {crediting && (
        <CreditNoteDialog
          invoice={crediting}
          onClose={() => setCrediting(null)}
          onIssued={(note) => {
            setCrediting(null)
            setNotice(`${note.credit_note_number} for ${formatUgx(note.total_minor)}.`)
            setRefreshToken((n) => n + 1)
            // The list carries credited/balance figures the note has just
            // changed, so it is re-read rather than patched in place.
            void load(filters, null)
          }}
        />
      )}
    </div>
  )
}
