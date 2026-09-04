import { useEffect, useState, type ReactNode } from 'react'
import { Badge } from '../../components/core/Badge'
import { Card } from '../../components/core/Card'
import { Identifier } from '../../components/core/Identifier'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { OurFleets } from '../company/OurFleets'
import { EmptyState } from '../../components/feedback/EmptyState'
import { apiClient } from '../../lib/apiClient'
import type { VehicleAllocation } from '../../types/allocation'
import type { ApiSuccess } from '../../types/api'
import type { Company } from '../../types/company'

/**
 * A corporate client's own organisation — the same `/companies` the
 * operator reads as a register of clients, read by the client as a page
 * about themselves.
 *
 * Two things a bank's transport officer wants to check here: that the
 * profile Shanitah invoices against is right, and which vehicles are
 * contracted to them — "vehicles supplied to the Bank" in Centenary's
 * letter, `VehicleAllocation` on the platform (ADR-0005, ADR-0009).
 *
 * ## What is not shown, on purpose
 *
 * - **The credit limit.** Recorded and audited, enforced by nothing
 *   (Modules/Clients README). To a client, "Credit limit UGX 0" reads as
 *   a fact about their account, and a zero standing in for "not
 *   configured" is exactly what docs/screen-rules.md §1 forbids.
 * - **The vehicle's VIN.** `VehicleAllocation.vehicle` carries the whole
 *   `Vehicle`; the client sees the plate, the make and model, the category
 *   and the seats — what they would read off the car — and not the chassis
 *   number, which is Shanitah's asset record.
 */

const STATUS_TONE: Record<Company['status'], 'success' | 'warning'> = {
  active: 'success',
  suspended: 'warning',
}

function formatDay(ymd: string): string {
  // `YYYY-MM-DD` from the server, rendered as the reader's locale date
  // without a timezone shift: this is a calendar day, not an instant.
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const ALLOCATION_COLUMNS: DataColumn<VehicleAllocation>[] = [
  {
    key: 'vehicle_id',
    card: 'title',
    header: 'Registration',
    render: (row) =>
      row.vehicle ? <Identifier kind="plate">{row.vehicle.registration_number}</Identifier> : '—',
  },
  {
    key: 'vehicle',
    card: 'meta',
    header: 'Vehicle',
    render: (row) => (row.vehicle ? `${row.vehicle.make} ${row.vehicle.model} ${row.vehicle.year}` : '—'),
  },
  {
    key: 'id',
    card: 'meta',
    header: 'Category',
    render: (row) => row.vehicle?.category ?? '—',
  },
  {
    key: 'tenant_id',
    card: 'meta',
    header: 'Seats',
    numeric: true,
    render: (row) => row.vehicle?.seating_capacity ?? '—',
  },
  { key: 'starts_on', card: 'meta', header: 'From', render: (row) => formatDay(row.starts_on) },
  {
    key: 'ends_on',
    card: 'meta',
    header: 'Until',
    render: (row) => (row.ends_on ? formatDay(row.ends_on) : 'Open-ended'),
  },
  {
    key: 'exclusive',
    card: 'meta',
    header: 'Basis',
    render: (row) => (row.exclusive ? 'Exclusive to you' : 'Shared'),
  },
  {
    key: 'in_force',
    card: 'status',
    header: 'Status',
    render: (row) =>
      row.in_force ? (
        <Badge tone="success" icon="check">
          In force
        </Badge>
      ) : (
        <Badge tone="neutral" icon="calendar-off">
          Not current
        </Badge>
      ),
  },
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children ?? '—'}</dd>
    </>
  )
}

export function OrganisationView() {
  const [company, setCompany] = useState<Company | null | undefined>(undefined)
  const [allocations, setAllocations] = useState<VehicleAllocation[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<ApiSuccess<Company[]>>('/companies')
      .then((response) => {
        // One company per client (Modules/Clients README). If the register
        // ever holds more, the first is still theirs — the scope guarantees
        // every row is.
        if (!cancelled) setCompany(response.data.data[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setCompany(null)
      })
    apiClient
      .get<ApiSuccess<VehicleAllocation[]>>('/allocations')
      .then((response) => {
        if (!cancelled) setAllocations(response.data.data)
      })
      .catch(() => {
        if (!cancelled) setAllocations(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const address = company
    ? [company.address_line1, company.address_line2, company.city, company.country].filter(Boolean).join(', ')
    : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
        title={company?.legal_name ?? (company === undefined ? 'Loading…' : 'Your organisation')}
        subtitle={company?.trading_name ? `Trading as ${company.trading_name}` : undefined}
        actions={company ? <Badge tone={STATUS_TONE[company.status]}>{company.status}</Badge> : undefined}
      >
        {company === null ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Your organisation's profile could not be loaded.
          </p>
        ) : (
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 'var(--space-2) var(--space-6)',
              margin: 0,
              maxWidth: 720,
            }}
          >
            <Field label="Registration number">
              {company?.registration_number ? <Identifier>{company.registration_number}</Identifier> : null}
            </Field>
            <Field label="Industry">{company?.industry}</Field>
            <Field label="Billing email">{company?.billing_email}</Field>
            <Field label="Phone">{company?.phone}</Field>
            <Field label="Address">{address || null}</Field>
          </dl>
        )}
        {/*
          Two sentences became six words.

          It read "Invoices are addressed to the billing email above. To change
          any of these details, contact your account manager at Shanitah
          General Enterprises Ltd." — a paragraph to say one thing, and the
          second half is not even true: a corporate admin already holds
          `companies.update` and can change these over the API. The line is cut
          to the fact that is both useful and correct; the editing route is a
          form, not a sentence, and it arrives with the branch work.
        */}
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', marginTop: 'var(--space-4)', marginBottom: 0 }}>
          Invoices go to the billing email.
        </p>
      </Card>

      {/*
        ADR-0060 §5. The safety catch in the whole onboarding flow: a second
        fleet may only *ask*, and without this screen there is nowhere for the
        client to answer. Placed above the vehicles because a pending request
        is a decision waiting on somebody, and the vehicles are a fact.
      */}
      <OurFleets />

      <Card
        title="Vehicles supplied to you"
        subtitle="Served before the wider fleet."
        padding="none"
      >
        {allocations && allocations.length === 0 ? (
          <EmptyState
            compact
            icon="car"
            title="No vehicles are contracted to you"
            description="Your bookings are served from the fleet as they come in."
          />
        ) : (
          <DataTable<VehicleAllocation>
            columns={ALLOCATION_COLUMNS}
            rows={allocations ?? []}
            emptyMessage={allocations === undefined ? 'Loading…' : 'Could not load the vehicles supplied to you'}
          />
        )}
      </Card>
    </div>
  )
}
