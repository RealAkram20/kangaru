import { Badge } from '../../components/core/Badge'
import { Icon } from '../../components/core/Icon'
import { formatTimestamp } from '../../lib/format'
import { tripStatusIcon, tripStatusLabel, tripStatusTone } from '../../lib/tripStatus'
import type { TripEvent, TripStatus } from '../../types/trip'

/**
 * The append-only `trip_events` timeline, oldest first — who moved the trip
 * to which state, when, with what note. Shared by the Trips page's side
 * panel and the trip record page so the two can never render the same
 * history differently.
 */
export function TripEventsList({ events }: { events: TripEvent[] }) {
  return (
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
              <span
                style={{
                  flex: 1,
                  width: 1,
                  background: 'var(--border-default)',
                  minHeight: 16,
                }}
              />
            )}
          </div>
          <div
            style={{
              paddingBottom: index < events.length - 1 ? 'var(--space-4)' : 0,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                flexWrap: 'wrap',
              }}
            >
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
            <p
              style={{
                font: 'var(--type-body-dense)',
                color: 'var(--text-body)',
                marginTop: 4,
              }}
            >
              {event.user ? event.user.name : 'System'}
              {event.notes && (
                <span style={{ color: 'var(--text-secondary)' }}> — {event.notes}</span>
              )}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
