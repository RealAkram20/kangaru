import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Icon } from '../../components/core/Icon'
import { Identifier } from '../../components/core/Identifier'
import { Alert } from '../../components/feedback/Alert'
import { TripTraceMap, type TracePoint } from '../../components/map/TripTraceMap'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { formatTimestamp, formatUgx } from '../../lib/format'
import {
  formatDistance,
  formatDuration,
  formatOdometer,
  RECORD_VERDICT,
  recordVerdict,
  tripStatusIcon,
  tripStatusLabel,
  tripStatusTone,
} from '../../lib/tripStatus'
import type { ApiSuccess } from '../../types/api'
import type { Invoice } from '../../types/billing'
import type { CursorMeta, Trip, TripEvent } from '../../types/trip'
import { OdometerPhoto } from './OdometerPhoto'
import { TripEventsList } from './TripEventsList'

/**
 * One trip, in full — the record a client is billed by.
 *
 * Centenary Bank's letter (CRDB/CS/F/26) asks that every trip carry, at a
 * minimum: when it commenced and completed, the vehicle's registration, its
 * origin and destination, the opening and closing odometer readings, the
 * distance and the duration. This page is those six facts as a sheet, with
 * the evidence behind them: the dashboard photograph behind each reading,
 * the GPS trace the readings were reconciled against, the platform's own
 * verdict on that reconciliation, the append-only timeline of who did what
 * when, and the invoice the trip produced.
 *
 * Read-only by design. Acting on a trip (transitions, invoicing) stays on
 * the Trips page, where the operator's roles work; the record page is what
 * both sides read when they want to agree on what happened.
 *
 * Every figure comes from `/trips/{id}` and its sub-resources. Nothing is
 * derived here; a missing value renders as an em dash and says why.
 */

type Loaded<T> = T | null | undefined

function Fact({ label, value, hint, children }: { label: string; value?: ReactNode; hint?: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</span>
      {value !== undefined && (
        <span style={{ font: 'var(--type-body)', color: 'var(--text-heading)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      )}
      {hint && <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{hint}</span>}
      {children}
    </div>
  )
}

export function TripRecordPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const tripId = Number(id)

  const [trip, setTrip] = useState<Loaded<Trip>>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<Loaded<TripEvent[]>>(undefined)
  const [trace, setTrace] = useState<Loaded<TracePoint[]>>(undefined)
  const [gpsKm, setGpsKm] = useState<number | null>(null)
  const [invoice, setInvoice] = useState<Loaded<Invoice | null>>(undefined)

  const validId = Number.isInteger(tripId) && tripId > 0

  useEffect(() => {
    if (!validId) return
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

    apiClient
      .get<ApiSuccess<Trip>>(`/trips/${tripId}`)
      .then((r) => {
        if (cancelled) return
        setTrip(r.data.data)
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        setTrip(null)
        setError(apiError(failure, 'This trip could not be loaded.').message)
      })
    settle(
      apiClient.get<ApiSuccess<TripEvent[], CursorMeta>>(`/trips/${tripId}/events`).then((r) => r.data.data),
      setEvents,
    )
    settle(
      apiClient
        .get<ApiSuccess<TracePoint[], CursorMeta & { gps_distance_km: number | null }>>(`/trips/${tripId}/locations?per_page=1000`)
        .then((r) => {
          if (!cancelled) setGpsKm(r.data.meta?.gps_distance_km ?? null)
          return r.data.data
        }),
      setTrace,
    )
    apiClient
      .get<ApiSuccess<Invoice[]>>('/invoices', { params: { trip_id: tripId } })
      .then((r) => {
        if (!cancelled) setInvoice(r.data.data[0] ?? null)
      })
      // A reader without `invoices.view` (a Corporate Employee) is refused
      // the invoice and simply does not see that card — that is theirs to
      // not see, not an error.
      .catch(() => {
        if (!cancelled) setInvoice(null)
      })

    return () => {
      cancelled = true
    }
  }, [tripId, validId])

  const verdict = trip ? recordVerdict(trip) : null
  const v = verdict ? RECORD_VERDICT[verdict] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <Button variant="ghost" size="sm" iconLeft="arrow-left" onClick={() => navigate('/trips')}>
          All trips
        </Button>
      </div>

      {(error || !validId) && (
        <Alert tone="error" title="Trip record">
          {error ?? 'This is not a trip number.'}
        </Alert>
      )}

      <Card
        title={trip ? `Trip #${trip.id}` : trip === undefined && validId ? 'Loading…' : 'Trip'}
        subtitle={
          trip
            ? `${trip.origin} → ${trip.destination}${trip.client ? ` · ${trip.client.name}` : ''}`
            : undefined
        }
        actions={
          trip ? (
            <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {v && (
                <Badge tone={v.tone} icon={v.icon} title={v.explain}>
                  {v.label}
                </Badge>
              )}
              <Badge tone={tripStatusTone(trip.status)} icon={tripStatusIcon(trip.status)}>
                {tripStatusLabel(trip.status)}
              </Badge>
            </span>
          ) : undefined
        }
      >
        {trip && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-5) var(--space-6)',
              }}
            >
              <Fact label="Commenced" value={trip.started_at ? formatTimestamp(trip.started_at) : '—'} hint={trip.started_at ? undefined : 'Not started'} />
              <Fact label="Completed" value={trip.completed_at ? formatTimestamp(trip.completed_at) : '—'} hint={trip.completed_at ? undefined : 'Not completed'} />
              <Fact label="Duration" value={formatDuration(trip.duration_minutes)} />
              <Fact
                label="Vehicle"
                value={trip.vehicle ? <Identifier kind="plate">{trip.vehicle.registration_number}</Identifier> : '—'}
                hint={trip.vehicle ? `${trip.vehicle.make} ${trip.vehicle.model} ${trip.vehicle.year}` : 'No vehicle assigned'}
              />
              <Fact label="From" value={trip.origin} />
              <Fact label="To" value={trip.destination} />
              <Fact label="Driver" value={trip.driver?.name ?? '—'} />
              <Fact
                label="Distance"
                value={formatDistance(trip.distance_km)}
                hint={
                  trip.gps_distance_km !== null
                    ? `GPS trace: ${formatDistance(trip.gps_distance_km)}`
                    : trip.distance_km !== null
                      ? 'No GPS trace to compare against'
                      : undefined
                }
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 'var(--space-6)',
                marginTop: 'var(--space-6)',
                paddingTop: 'var(--space-6)',
                borderTop: '1px solid var(--border-default)',
              }}
            >
              <Fact label="Opening odometer" value={formatOdometer(trip.odometer_start)}>
                {trip.odometer_start !== null && <OdometerPhoto tripId={trip.id} moment="start" label="Opening" />}
              </Fact>
              <Fact label="Closing odometer" value={formatOdometer(trip.odometer_end)}>
                {trip.odometer_end !== null && <OdometerPhoto tripId={trip.id} moment="end" label="Closing" />}
              </Fact>
            </div>

            {v && (
              <p
                style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  alignItems: 'flex-start',
                  marginTop: 'var(--space-6)',
                  marginBottom: 0,
                  font: 'var(--type-body-dense)',
                  color: 'var(--text-secondary)',
                }}
              >
                <Icon name={v.icon} size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  <strong style={{ color: 'var(--text-heading)' }}>{v.label}.</strong> {v.explain}
                </span>
              </p>
            )}
          </>
        )}
      </Card>

      {trip && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)',
            gap: 'var(--space-4)',
            alignItems: 'start',
          }}
        >
          <Card
            title="Recorded route"
            subtitle={
              trace && trace.length > 0
                ? `${trace.length} GPS positions${gpsKm !== null ? ` · ${gpsKm.toLocaleString('en-US', { maximumFractionDigits: 1 })} km by GPS` : ''}`
                : undefined
            }
            padding={trace && trace.length > 0 ? 'none' : 'md'}
          >
            {trace === undefined && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading trace…</p>}
            {trace === null && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>The GPS trace could not be loaded.</p>}
            {trace && trace.length === 0 && (
              <p style={{ margin: 0, color: 'var(--text-secondary)', font: 'var(--type-body-dense)' }}>
                No GPS trace was recorded for this trip. The odometer readings stand on their own; the record says so
                rather than drawing a road.
              </p>
            )}
            {trace && trace.length > 0 && <TripTraceMap points={trace} height={360} />}
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {invoice !== undefined && invoice !== null && (
              <Card
                title="Invoice"
                subtitle="Issued from this trip's stored readings and the rate card in force"
                actions={
                  <Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => navigate('/invoices')}>
                    Invoices
                  </Button>
                }
              >
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2) var(--space-4)', margin: 0 }}>
                  <dt style={{ color: 'var(--text-secondary)' }}>Number</dt>
                  <dd style={{ margin: 0 }}>
                    <Identifier>{invoice.invoice_number}</Identifier>
                  </dd>
                  <dt style={{ color: 'var(--text-secondary)' }}>Issued</dt>
                  <dd style={{ margin: 0 }}>{formatTimestamp(invoice.issued_at)}</dd>
                  <dt style={{ color: 'var(--text-secondary)' }}>Invoiced</dt>
                  <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{formatUgx(invoice.total_minor)}</dd>
                  {invoice.credited_minor > 0 && (
                    <>
                      <dt style={{ color: 'var(--text-secondary)' }}>Credited</dt>
                      <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>−{formatUgx(invoice.credited_minor)}</dd>
                    </>
                  )}
                  <dt style={{ color: 'var(--text-secondary)' }}>Balance</dt>
                  <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatUgx(invoice.balance_minor)}</dd>
                </dl>
              </Card>
            )}

            <Card title="Timeline" subtitle="Append-only. Who moved this trip, to what, and when.">
              {events === undefined && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading timeline…</p>}
              {events === null && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>The timeline could not be loaded.</p>}
              {events && <TripEventsList events={events} />}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
