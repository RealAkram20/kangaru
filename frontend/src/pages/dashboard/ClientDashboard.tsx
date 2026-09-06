import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Icon } from '../../components/core/Icon'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { KPIStat } from '../../components/data/KPIStat'
import { StatGrid } from '../../components/data/StatGrid'
import { useIsCompact } from '../../lib/useMediaQuery'
import { EmptyState } from '../../components/feedback/EmptyState'
import { apiClient } from '../../lib/apiClient'
import { canViewInvoices } from '../../lib/billing'
import { bookingStatusIcon, bookingStatusLabel, bookingStatusTone, pickupLabel } from '../../lib/bookingStatus'
import { formatTimestamp, formatUgx } from '../../lib/format'
import { currentMonth } from '../../lib/period'
import {
  formatDistance,
  formatDuration,
  formatOdometer,
  tripStatusIcon,
  tripStatusLabel,
  tripStatusTone,
} from '../../lib/tripStatus'
import type { ApiSuccess } from '../../types/api'
import type { Booking } from '../../types/booking'
import type { LivePosition } from '../../types/livePosition'
import type { FinancialReportMeta, TripReportMeta, TripReportRow } from '../../types/report'
import type { Trip } from '../../types/trip'

/**
 * The corporate client's dashboard — what a bank's transport officer opens
 * in the morning.
 *
 * Centenary Bank's letter of 22 July 2026 asked for one thing: to see, for
 * every vehicle supplied to them, when each trip began and ended, which
 * vehicle, from where to where, the opening and closing odometer, the
 * distance and the duration. This page is that, at a glance; the Trips and
 * Reports pages are that, in full.
 *
 * ## Where every number comes from
 *
 * Nothing here is computed on the client. The month's trips and distance
 * are `meta.summary` of `/reports/trips`; the month's invoicing and the
 * outstanding balance are `meta.summary` of `/reports/financial` — the
 * *same* responses the Reports page renders, so the dashboard and the
 * report agree by construction and there is one aggregation to audit, not
 * two. Every endpoint is tenant-scoped server-side (ADR-0001, ADR-0006);
 * this page never passes a `tenant_id`.
 *
 * ## The two corporate roles
 *
 * A Corporate Admin holds `reports.view` and `invoices.view`; a Corporate
 * Employee holds neither — unless their administrator switched on
 * `sees_finance` (App\Enums\ClientCapability) — and otherwise sees only
 * their own bookings and trips. The figures section is offered to whoever
 * may read finance and not requested for the rest — a request that answers
 * 403 is not a feature (lib/navigation.ts).
 */


/** How many recent trips to show before pointing at the Trips page. */
const RECENT_TRIPS = 8

const TRIP_COLUMNS: DataColumn<Trip>[] = [
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <Badge tone={tripStatusTone(row.status)} icon={tripStatusIcon(row.status)}>
        {tripStatusLabel(row.status)}
      </Badge>
    ),
  },
  {
    key: 'origin',
    header: 'Route',
    render: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {row.origin}
        <Icon name="arrow-right" size={13} style={{ color: 'var(--text-secondary)' }} />
        {row.destination}
      </span>
    ),
  },
  {
    key: 'vehicle_id',
    header: 'Vehicle',
    render: (row) => row.vehicle?.registration_number ?? '—',
  },
  {
    key: 'started_at',
    header: 'Commenced',
    render: (row) => (row.started_at ? formatTimestamp(row.started_at) : '—'),
  },
  {
    key: 'completed_at',
    header: 'Completed',
    render: (row) => (row.completed_at ? formatTimestamp(row.completed_at) : '—'),
  },
  {
    key: 'odometer_start',
    header: 'Odometer',
    numeric: true,
    render: (row) => `${formatOdometer(row.odometer_start)} / ${formatOdometer(row.odometer_end)}`,
  },
  {
    key: 'distance_km',
    header: 'Distance',
    numeric: true,
    render: (row) => formatDistance(row.distance_km),
  },
  {
    key: 'duration_minutes',
    header: 'Duration',
    numeric: true,
    render: (row) => formatDuration(row.duration_minutes),
  },
]

const PENDING_COLUMNS: DataColumn<Booking>[] = [
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <Badge tone={bookingStatusTone(row.status)} icon={bookingStatusIcon(row.status)}>
        {bookingStatusLabel(row.status)}
      </Badge>
    ),
  },
  { key: 'scheduled_for', header: 'Pickup', render: (row) => pickupLabel(row) },
  {
    key: 'origin',
    header: 'Route',
    render: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {row.origin}
        <Icon name="arrow-right" size={13} style={{ color: 'var(--text-secondary)' }} />
        {row.destination}
      </span>
    ),
  },
  { key: 'passenger_name', header: 'Passenger' },
  { key: 'requested_by', header: 'Requested by', render: (row) => row.requested_by?.name ?? '—' },
]

/**
 * One section's data: `undefined` while loading, `null` when the request
 * failed or was refused, otherwise the value. Sections fail one at a time —
 * a refused report must not blank the trips beside it.
 */
type Loaded<T> = T | null | undefined

interface Figures {
  trips: TripReportMeta['summary']
  month: FinancialReportMeta['summary']
  toDate: FinancialReportMeta['summary']
}

async function loadFigures(): Promise<Figures> {
  const period = currentMonth()
  const range = `from=${period.from}&to=${period.to}`
  const [trips, month, toDate] = await Promise.all([
    apiClient.get<ApiSuccess<TripReportRow[], TripReportMeta>>(`/reports/trips?${range}`),
    apiClient.get<ApiSuccess<unknown[], FinancialReportMeta>>(`/reports/financial?${range}&group_by=month`),
    // No range: the server reads that as "from the beginning to today",
    // which is what a balance is.
    apiClient.get<ApiSuccess<unknown[], FinancialReportMeta>>('/reports/financial?group_by=year'),
  ])
  if (!trips.data.meta || !month.data.meta || !toDate.data.meta) throw new Error('Report meta missing')
  return { trips: trips.data.meta.summary, month: month.data.meta.summary, toDate: toDate.data.meta.summary }
}

export function ClientDashboard() {
  const { user } = useAuth()
  const compact = useIsCompact()
  const navigate = useNavigate()
  // Money and month figures for whoever the server lets read invoices and
  // reports — a Corporate Admin by role, or an employee switched on to
  // `sees_finance` (App\Enums\ClientCapability). Same rule the Invoices
  // menu entry uses.
  const withFigures = canViewInvoices(user)
  const mayApprove = user?.role === 'corporate_admin' || (user?.capabilities ?? []).includes('approves_bookings')

  const [figures, setFigures] = useState<Loaded<Figures>>(undefined)
  const [pending, setPending] = useState<Loaded<Booking[]>>(undefined)
  const [onRoad, setOnRoad] = useState<Loaded<LivePosition[]>>(undefined)
  const [recent, setRecent] = useState<Loaded<Trip[]>>(undefined)

  useEffect(() => {
    let cancelled = false
    const settle = <T,>(promise: Promise<T>, set: (value: Loaded<T>) => void) => {
      promise.then(
        (value) => {
          if (!cancelled) set(value)
        },
        () => {
          if (!cancelled) set(null)
        },
      )
    }

    if (withFigures) settle(loadFigures(), setFigures)
    settle(
      apiClient.get<ApiSuccess<Booking[]>>('/bookings?status=pending').then((r) => r.data.data),
      setPending,
    )
    settle(
      apiClient.get<ApiSuccess<LivePosition[]>>('/live-positions').then((r) => r.data.data),
      setOnRoad,
    )
    settle(
      apiClient.get<ApiSuccess<Trip[]>>('/trips').then((r) => r.data.data.slice(0, RECENT_TRIPS)),
      setRecent,
    )

    return () => {
      cancelled = true
    }
  }, [withFigures])

  const monthTrips = figures?.trips
  const monthMoney = figures?.month
  const balance = figures?.toDate

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {withFigures && (
        <StatGrid aria-label="This month">
          <KPIStat
            label="Trips this month"
            value={monthTrips ? monthTrips.trips_completed : '—'}
            unit={monthTrips ? 'completed' : undefined}
            icon="navigation"
            hint={
              monthTrips
                ? `${monthTrips.trips} commenced`
                : figures === null
                  ? 'Report unavailable'
                  : undefined
            }
          />
          <KPIStat
            // The letter's six data points, on every trip: `completeness_percent`
            // is the server's own count of trips whose record is whole. Null
            // when nothing has completed yet — that is "—", not 100 %.
            label="Records complete"
            value={
              monthTrips
                ? monthTrips.completeness_percent === null
                  ? '—'
                  : `${monthTrips.completeness_percent}%`
                : '—'
            }
            icon={monthTrips && monthTrips.records_incomplete > 0 ? 'circle-alert' : 'shield-check'}
            hint={
              monthTrips
                ? monthTrips.records_incomplete > 0
                  ? `${monthTrips.records_incomplete} ${monthTrips.records_incomplete === 1 ? 'trip is' : 'trips are'} missing an odometer reading`
                  : monthTrips.completeness_percent === null
                    ? 'No trip has completed yet this month'
                    : 'Every completed trip has all six data points'
                : undefined
            }
            role="link"
            tabIndex={0}
            aria-label="Records complete — open Trips"
            onClick={() => navigate('/trips')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') navigate('/trips')
            }}
            style={{ cursor: 'pointer' }}
          />
          {/* Full width, not paired: it is the third of three short
              tiles, so pairing leaves it beside an empty half — a gap
              reads as broken where a wide card reads as deliberate. */}
          <KPIStat
            wide
            label="Distance this month"
            value={monthTrips ? monthTrips.distance_km.toLocaleString('en-US') : '—'}
            unit={monthTrips ? 'km' : undefined}
            icon="gauge"
            hint={monthTrips ? `${formatDuration(monthTrips.duration_minutes)} on the road` : undefined}
          />
          <KPIStat
            wide
            label="Invoiced this month"
            value={monthMoney ? formatUgx(monthMoney.invoiced_minor - monthMoney.credited_minor) : '—'}
            icon="receipt"
            hint={
              monthMoney
                ? monthMoney.credited_minor > 0
                  ? `${monthMoney.invoices} invoices, less ${formatUgx(monthMoney.credited_minor)} credited`
                  : `${monthMoney.invoices} invoices`
                : undefined
            }
          />
          <KPIStat
            wide
            tone="accent"
            label="Outstanding"
            value={balance ? formatUgx(balance.outstanding_minor) : '—'}
            icon="wallet"
            // ADR-0007: payments are not recorded on the platform, so this
            // is invoiced less credited, and says so rather than implying a
            // ledger that does not exist.
            hint={balance ? (balance.payments_recorded ? 'To date' : 'Invoiced less credit notes; payments are not recorded here') : undefined}
          />
        </StatGrid>
      )}

      {/*
        Stacked on a phone, two columns above it.

        `minmax(0, 2fr) minmax(240px, 1fr)` held both columns at every width,
        so at 360px the approvals table got about 90px and set
        "Kololo → Entebbe International Airport" one character per line, down
        the screen. `minmax(0, …)` prevents the *grid* overflowing, which is
        why nothing showed up as horizontal overflow in the audit — the text
        was destroyed inside its track instead.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0, 2fr) minmax(240px, 1fr)',
          gap: 'var(--space-4)',
          alignItems: 'start',
        }}
      >
        <Card
          title={mayApprove ? 'Awaiting your approval' : 'Your requests awaiting approval'}
          subtitle={
            pending && pending.length > 0
              ? `${pending.length} pending`
              : undefined
          }
          actions={
            <Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => navigate('/bookings')}>
              {mayApprove ? 'Review in Bookings' : 'All bookings'}
            </Button>
          }
          padding="none"
        >
          {pending && pending.length === 0 ? (
            <EmptyState
              compact
              icon="circle-check"
              title="Nothing waiting"
              description={
                mayApprove
                  ? 'New transport requests from your staff will appear here.'
                  : 'Requests you make will appear here until they are approved.'
              }
            />
          ) : (
            <DataTable<Booking>
              columns={PENDING_COLUMNS}
              rows={pending ?? []}
              dense
              onRowClick={() => navigate('/bookings')}
              emptyMessage={pending === undefined ? 'Loading…' : 'Could not load bookings'}
            />
          )}
        </Card>

        <Card title="On the road now" padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span
                style={{
                  font: 'var(--type-kpi)',
                  fontSize: 'var(--text-3xl)',
                  color: 'var(--text-heading)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {onRoad ? onRoad.length : '—'}
              </span>
              <span style={{ font: 'var(--type-label)', color: 'var(--text-secondary)' }}>
                {onRoad && onRoad.length === 1 ? 'vehicle reporting a position' : 'vehicles reporting a position'}
              </span>
            </div>
            <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
              {onRoad === null
                ? 'Live positions are unavailable right now.'
                : 'Vehicles on your trips whose handset has sent a GPS position recently.'}
            </p>
            <Button variant="secondary" size="sm" iconLeft="map" onClick={() => navigate('/live-map')}>
              Open live map
            </Button>
          </div>
        </Card>
      </div>

      <Card
        title="Recent trips"
        subtitle="When each trip commenced and completed, the vehicle, its odometer readings, the distance and the duration"
        actions={
          <Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => navigate('/trips')}>
            All trips
          </Button>
        }
        padding="none"
      >
        <DataTable<Trip>
          columns={TRIP_COLUMNS}
          rows={recent ?? []}
          dense
          onRowClick={(row) => navigate(`/trips/${row.id}`)}
          emptyMessage={
            recent === undefined ? 'Loading…' : recent === null ? 'Could not load trips' : 'No trips yet'
          }
        />
      </Card>
    </div>
  )
}
