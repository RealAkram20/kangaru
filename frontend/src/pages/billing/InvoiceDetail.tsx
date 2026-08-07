import { useEffect, useState } from 'react'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Icon } from '../../components/core/Icon'
import { Identifier } from '../../components/core/Identifier'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { lineTypeTone } from '../../lib/billing'
import { formatTimestamp, formatUgx } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type { CreditNote, Invoice, InvoiceLine } from '../../types/billing'

/** DataTable keys rows off `id`; a line's natural key is its line_number. */
type LineRow = InvoiceLine & { id: number }

const LINE_COLUMNS: DataColumn<LineRow>[] = [
  {
    key: 'type',
    header: 'Type',
    render: (row) => (
      <Badge tone={lineTypeTone(row.type)} size="sm">
        {row.type_label}
      </Badge>
    ),
  },
  { key: 'description', header: 'Description', wrap: true },
  {
    key: 'inputs',
    // Both this and the Multiplier column below read `inputs`, so each needs
    // its own identity or they share a React key and neither can be sorted.
    id: 'zone',
    header: 'Zone',
    // Null means the vehicle category's default rate priced this line, which
    // is the meaning the column has carried since before zone pricing
    // existed — so every invoice issued earlier still reads correctly here.
    // A dash rather than "Anywhere else": on an issued document the question
    // is "did a zone move this number", and the answer is no.
    render: (row) => row.inputs.zone ?? '—',
  },
  {
    key: 'quantity',
    header: 'Qty',
    numeric: true,
    // Trailing ".00" on a flat line is noise; a distance keeps its precision.
    render: (row) => (Number(row.quantity) % 1 === 0 ? String(Number(row.quantity)) : row.quantity),
  },
  {
    key: 'unit_amount_minor',
    header: 'Unit',
    numeric: true,
    render: (row) => formatUgx(row.unit_amount_minor),
  },
  {
    key: 'inputs',
    id: 'multiplier',
    header: 'Multiplier',
    numeric: true,
    // Shown for every line, including the ones no multiplier touched, so
    // "was a multiplier applied here?" is answered by the row rather than
    // by inference — the same reason the column is stored on every line.
    render: (row) =>
      row.inputs.multiplier_bp === 10_000 ? '—' : `${(row.inputs.multiplier_bp / 10_000).toFixed(2)}x`,
  },
  {
    key: 'amount_minor',
    header: 'Amount',
    numeric: true,
    render: (row) => (
      <span style={{ fontWeight: 'var(--weight-medium)' }}>{formatUgx(row.amount_minor)}</span>
    ),
  },
]

/**
 * One issued invoice: its lines with the inputs that produced them, and
 * every credit note raised against it.
 *
 * There is no edit control anywhere on this panel, and that is the point.
 * AGENTS.md requires corrections to be credit notes, "never silent edits to
 * issued invoices" — the backend models refuse an update outright, so a
 * pencil icon here would be a button that cannot work.
 */
export function InvoiceDetail({
  uuid,
  onClose,
  onCreditNote,
  canCredit,
  refreshToken,
}: {
  uuid: string
  onClose: () => void
  onCreditNote: (invoice: Invoice) => void
  canCredit: boolean
  /** Bumped by the parent after a credit note lands, to force a re-fetch. */
  refreshToken: number
}) {
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // No `setInvoice(null)` reset here: the parent keys this component by
    // uuid, so switching invoices remounts it with fresh state, and a
    // refresh after a credit note should swap the figures in place rather
    // than blink the whole panel back to "Loading…".
    apiClient
      .get<ApiSuccess<Invoice>>(`/invoices/${uuid}`)
      .then((response) => {
        if (!cancelled) setInvoice(response.data.data)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(apiError(failure, 'Could not load this invoice.').message)
      })

    return () => {
      cancelled = true
    }
  }, [uuid, refreshToken])

  if (error) {
    return (
      <Card title="Invoice">
        <p style={{ color: 'var(--kr-error)' }}>{error}</p>
      </Card>
    )
  }

  if (!invoice) {
    return (
      <Card title="Invoice">
        <p style={{ color: 'var(--text-secondary)' }}>Loading invoice…</p>
      </Card>
    )
  }

  const credited = invoice.credited_minor > 0

  return (
    <Card
      title={invoice.invoice_number}
      subtitle={`Trip #${invoice.trip_id} · issued ${formatTimestamp(invoice.issued_at)} · rate card version ${invoice.rate_card_version_id}`}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-inline)' }}>
          {canCredit && (
            <Button size="sm" variant="secondary" iconLeft="receipt-text" onClick={() => onCreditNote(invoice)}>
              Issue credit note
            </Button>
          )}
          <button
            onClick={onClose}
            aria-label="Close invoice"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              font: 'var(--type-label)',
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Icon name="x" size={14} />
            Close
          </button>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Fact label="Invoiced" value={formatUgx(invoice.total_minor)} />
        <Fact label="Credited" value={credited ? `−${formatUgx(invoice.credited_minor)}` : '—'} />
        <Fact label="Balance" value={formatUgx(invoice.balance_minor)} emphasis />
        <Fact label="Currency" value={invoice.currency} />
      </div>

      <SectionHeading>Lines</SectionHeading>
      <DataTable<LineRow>
        columns={LINE_COLUMNS}
        rows={(invoice.lines ?? []).map((line) => ({ ...line, id: line.line_number }))}
        dense
        emptyMessage="This invoice has no lines"
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--space-6)',
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--border-default)',
          font: 'var(--type-body)',
          color: 'var(--text-heading)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>Invoice total</span>
        <span style={{ fontWeight: 'var(--weight-medium)' }}>{formatUgx(invoice.total_minor)}</span>
      </div>

      <SectionHeading>Credit notes</SectionHeading>
      {invoice.credit_notes && invoice.credit_notes.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
          {invoice.credit_notes.map((note) => (
            <CreditNoteRow key={note.uuid} note={note} />
          ))}
        </ul>
      ) : (
        <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
          None. This invoice stands as issued.
        </p>
      )}
    </Card>
  )
}

function CreditNoteRow({ note }: { note: CreditNote }) {
  return (
    <li
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Identifier size="sm">{note.credit_note_number}</Identifier>
        <span style={{ font: 'var(--type-body)', color: 'var(--kr-error)', fontVariantNumeric: 'tabular-nums' }}>
          −{formatUgx(note.total_minor)}
        </span>
        <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          {formatTimestamp(note.issued_at)}
        </span>
      </div>
      <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-body)', marginTop: 4 }}>{note.reason}</p>
      {note.lines && note.lines.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 'var(--space-2) 0 0',
            padding: 0,
            font: 'var(--type-caption)',
            color: 'var(--text-secondary)',
          }}
        >
          {note.lines.map((line) => (
            <li key={line.line_number}>
              {line.description} — {formatUgx(line.amount_minor)}
              {line.invoice_line_id !== null && ` (against line ${line.invoice_line_id})`}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3
      style={{
        font: 'var(--type-label)',
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        margin: 'var(--space-6) 0 var(--space-3)',
      }}
    >
      {children}
    </h3>
  )
}

function Fact({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</p>
      <p
        style={{
          font: 'var(--type-body)',
          color: emphasis ? 'var(--kr-green-dark)' : 'var(--text-heading)',
          fontWeight: emphasis ? 'var(--weight-medium)' : undefined,
          fontVariantNumeric: 'tabular-nums',
          marginTop: 2,
        }}
      >
        {value}
      </p>
    </div>
  )
}
