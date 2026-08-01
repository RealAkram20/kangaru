import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { formatTimestamp } from '../lib/format'
import {
  formatDistance,
  formatDuration,
  formatOdometer,
  isDestructiveTransition,
  tripStatusIcon,
  tripStatusLabel,
  tripStatusTone,
} from '../lib/tripStatus'
import type { ApiSuccess } from '../types/api'
import type { CursorMeta, Trip, TripEvent, TripStatus } from '../types/trip'
import { TransitionDialog } from './trips/TransitionDialog'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Icon } from '../components/core/Icon'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Input } from '../components/forms/Input'

const COLUMNS: DataColumn<Trip>[] = [
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
    key: 'driver_id',
    header: 'Driver',
    render: (row) => row.driver?.name ?? '—',
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
  {
    key: 'started_at',
    header: 'Started',
    render: (row) => (row.started_at ? formatTimestamp(row.started_at) : '—'),
  },
  {
    key: 'completed_at',
    header: 'Completed',
    render: (row) => (row.completed_at ? formatTimestamp(row.completed_at) : '—'),
  },
]

export function TripsPage() {
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Trip | null>(null)
  const [transitionTo, setTransitionTo] = useState<TripStatus | null>(null)

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Trip[], CursorMeta>>('/trips')
      .then((response) => setTrips(response.data.data))
      .catch(() => setError('Could not load trips.'))
  }, [])

  // The response to a transition is the updated trip, so the row and the
  // open panel are refreshed from it rather than re-fetching the list.
  const applyTransition = (updated: Trip) => {
    setTrips((current) => current?.map((t) => (t.id === updated.id ? updated : t)) ?? null)
    setSelected(updated)
    setTransitionTo(null)
  }

  const filtered = useMemo(() => {
    if (!trips) return []
    const q = query.trim().toLowerCase()
    if (!q) return trips
    return trips.filter(
      (t) =>
        t.origin.toLowerCase().includes(q) ||
        t.destination.toLowerCase().includes(q) ||
        t.vehicle?.registration_number.toLowerCase().includes(q) ||
        t.driver?.name.toLowerCase().includes(q) ||
        tripStatusLabel(t.status).toLowerCase().includes(q),
    )
  }, [trips, query])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
        title="Trips"
        subtitle={trips ? `${trips.length} total — select a trip to see its timeline` : undefined}
        actions={
          <Input
            iconLeft="search"
            placeholder="Filter by route, vehicle, driver or status"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 300 }}
          />
        }
        padding="none"
      >
        {error ? (
          <p style={{ padding: 'var(--space-6)', color: 'var(--kr-error)' }}>{error}</p>
        ) : (
          <DataTable<Trip>
            columns={COLUMNS}
            rows={filtered}
            dense
            onRowClick={(row) => setSelected((current) => (current?.id === row.id ? null : row))}
            emptyMessage={trips === null ? 'Loading…' : query ? 'No trips match your filter' : 'No trips yet'}
          />
        )}
      </Card>

      {/* Keyed by id so switching trips remounts with fresh state rather
          than clearing the previous trip's events inside an effect. */}
      {selected && (
        <TripTimeline
          key={selected.id}
          trip={selected}
          onClose={() => setSelected(null)}
          onTransition={setTransitionTo}
        />
      )}

      {selected && transitionTo && (
        <TransitionDialog
          trip={selected}
          to={transitionTo}
          onClose={() => setTransitionTo(null)}
          onDone={applyTransition}
        />
      )}
    </div>
  )
}

/**
 * The trip's bank-required facts, the actions its current state permits,
 * and the append-only `trip_events` timeline.
 *
 * The action buttons come from `trip.allowed_transitions`, which the API
 * derives from TripStatus — this component has no copy of the lifecycle
 * graph and cannot drift from it. What the *user* may do is still the
 * server's call; an unauthorised attempt comes back 403.
 */
function TripTimeline({
  trip,
  onClose,
  onTransition,
}: {
  trip: Trip
  onClose: () => void
  onTransition: (to: TripStatus) => void
}) {
  const [events, setEvents] = useState<TripEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<TripEvent[], CursorMeta>>(`/trips/${trip.id}/events`)
      .then((response) => {
        if (!cancelled) setEvents(response.data.data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this trip’s timeline.')
      })

    return () => {
      cancelled = true
    }
  }, [trip.id])

  return (
    <Card
      title={`Trip #${trip.id} — ${trip.origin} → ${trip.destination}`}
      subtitle={`${trip.vehicle?.registration_number ?? 'No vehicle'} · ${trip.driver?.name ?? 'No driver'}`}
      actions={
        <button
          onClick={onClose}
          aria-label="Close timeline"
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
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Fact label="Opening odometer" value={formatOdometer(trip.odometer_start)} />
        <Fact label="Closing odometer" value={formatOdometer(trip.odometer_end)} />
        <Fact label="Distance travelled" value={formatDistance(trip.distance_km)} />
        <Fact label="Duration" value={formatDuration(trip.duration_minutes)} />
        <Fact label="Commenced" value={trip.started_at ? formatTimestamp(trip.started_at) : '—'} />
        <Fact label="Completed" value={trip.completed_at ? formatTimestamp(trip.completed_at) : '—'} />
      </div>

      {trip.allowed_transitions.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--gap-inline)',
            paddingBottom: 'var(--space-6)',
            borderBottom: '1px solid var(--border-default)',
            marginBottom: 'var(--space-6)',
          }}
        >
          {trip.allowed_transitions.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={isDestructiveTransition(to) ? 'secondary' : 'primary'}
              iconLeft={tripStatusIcon(to)}
              onClick={() => onTransition(to)}
            >
              {tripStatusLabel(to)}
            </Button>
          ))}
        </div>
      )}

      {error && <p style={{ color: 'var(--kr-error)' }}>{error}</p>}
      {!error && events === null && <p style={{ color: 'var(--text-secondary)' }}>Loading timeline…</p>}

      {events && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {events.map((event, index) => (
            <li key={event.id} style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  <Icon name={tripStatusIcon(event.to_status)} size={12} />
                </span>
                {index < events.length - 1 && (
                  <span style={{ flex: 1, width: 1, background: 'var(--border-default)', minHeight: 16 }} />
                )}
              </div>
              <div style={{ paddingBottom: index < events.length - 1 ? 'var(--space-4)' : 0, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Badge tone={tripStatusTone(event.to_status)} size="sm">
                    {tripStatusLabel(event.to_status)}
                  </Badge>
                  <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                    {formatTimestamp(event.created_at)}
                  </span>
                  {event.from_status && (
                    <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                      from {tripStatusLabel(event.from_status as TripStatus)}
                    </span>
                  )}
                </div>
                <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-body)', marginTop: 4 }}>
                  {event.user ? event.user.name : 'System'}
                  {event.notes && <span style={{ color: 'var(--text-secondary)' }}> — {event.notes}</span>}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</p>
      <p
        style={{
          font: 'var(--type-body)',
          color: 'var(--text-heading)',
          fontVariantNumeric: 'tabular-nums',
          marginTop: 2,
        }}
      >
        {value}
      </p>
    </div>
  )
}
