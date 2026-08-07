import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/core/Badge'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { FleetMap } from '../components/map/FleetMap'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { byAttention, freshnessLabel, POLL_MS, speedLabel, toneFor } from '../lib/livePositions'
import type { ApiSuccess } from '../types/api'
import type { LivePosition } from '../types/livePosition'

/**
 * Where the fleet is right now (ADR-0019).
 *
 * `GET /live-positions` has existed since ADR-0019 and nothing rendered it,
 * so a dispatcher could read that a trip was in progress but not see it
 * move. The endpoint is already scoped — tenant, then the `trips.view.all`
 * predicate, resolved through trips rather than through positions — so this
 * page filters nothing and simply draws what it is given. A corporate
 * employee opening it sees their own ride; a platform dispatcher sees the
 * fleet.
 *
 * ## Polling, and why the tab matters
 *
 * ADR-0019 chose polling and named broadcasting over Reverb as the better
 * answer it deliberately defers. So: one request every `POLL_MS`, and
 * **nothing at all while the tab is hidden**. A dispatcher leaves this open
 * all day behind other windows; without that check, 200 dashboards would
 * spend the whole night asking where a fleet that stopped at six is.
 *
 * The first paint after returning to the tab is immediate rather than one
 * interval late, because coming back to a map showing where things were ten
 * seconds ago is exactly when it is most misleading.
 */
export function LiveMapPage() {
  const [positions, setPositions] = useState<LivePosition[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    // Both guards belong to this effect's lifetime, so they live in it
    // rather than in refs: `live` drops a response that lands after the page
    // is closed, and `latest` drops a slow poll overtaken by a newer one —
    // out-of-order responses would otherwise redraw the map with older
    // positions and there would be nothing on screen to say so.
    let live = true
    let latest = 0

    // `.then()` rather than `async`/`await`, the shape DriversPage
    // documents: a synchronous call to an awaiting helper reads to
    // `react-hooks/set-state-in-effect` as a set during render.
    const load = () => {
      const mine = ++latest

      return apiClient
        .get<ApiSuccess<LivePosition[]>>('/live-positions')
        .then((response) => {
          if (!live || mine !== latest) return
          setPositions(response.data.data)
          setError(null)
        })
        .catch((failure: unknown) => {
          if (!live || mine !== latest) return
          // Deliberately does not clear `positions`. A dropped request is not
          // evidence the fleet vanished, and blanking the map on every blip
          // would make it useless on a bad connection — a dispatcher reads a
          // blank map as "everything stopped". The banner says the refresh
          // failed; the markers stay, and their own `age_seconds` will start
          // reading stale if it persists.
          setError(apiError(failure, 'Could not refresh vehicle positions.').message)
        })
    }

    const start = () => {
      void load()
      timer = setInterval(() => void load(), POLL_MS)
    }

    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }

    const onVisibility = () => {
      stop()
      if (document.visibilityState === 'visible') start()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      // Invalidates any request already in flight.
      live = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const ordered = useMemo(() => [...(positions ?? [])].sort(byAttention), [positions])

  const staleCount = ordered.filter((p) => p.stale).length

  if (positions === null && error === null) {
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error !== null && (
        <Alert tone="warning" title="Positions may be out of date" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {ordered.length === 0 ? (
        <Card>
          <EmptyState
            icon="map-pin-off"
            title="Nothing is moving"
            description="Vehicles appear here once a trip is under way and the driver's app is reporting. Assign a trip on the dispatch board to see it."
          />
        </Card>
      ) : (
        <>
          <Card
            padding="none"
            title="Fleet"
            subtitle={
              staleCount > 0
                ? `${ordered.length} on the road · ${staleCount} not reporting`
                : `${ordered.length} on the road`
            }
          >
            <FleetMap positions={ordered} onSelect={setSelected} />
          </Card>

          <Card padding="none" title="Vehicles" subtitle="Not reporting first">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--kr-gray-text)' }}>
                  <th style={CELL}>Vehicle</th>
                  <th style={CELL}>Trip</th>
                  <th style={CELL}>Status</th>
                  <th style={CELL}>Speed</th>
                  <th style={CELL}>Last report</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((position) => {
                  const tone = toneFor(position)
                  return (
                    <tr
                      key={position.vehicle_id}
                      style={{
                        borderTop: '1px solid var(--kr-gray-border)',
                        background:
                          selected === position.vehicle_id ? 'var(--surface-accent)' : undefined,
                      }}
                    >
                      <td style={CELL}>#{position.vehicle_id}</td>
                      <td style={CELL}>#{position.trip_id}</td>
                      <td style={CELL}>
                        <Badge
                          tone={
                            tone === 'stale' ? 'neutral' : tone === 'moving' ? 'success' : 'info'
                          }
                          icon={
                            tone === 'stale'
                              ? 'signal-zero'
                              : tone === 'moving'
                                ? 'navigation'
                                : 'circle-pause'
                          }
                          size="sm"
                        >
                          {tone === 'stale' ? 'Not reporting' : tone === 'moving' ? 'Moving' : 'Stopped'}
                        </Badge>
                      </td>
                      <td style={CELL}>{speedLabel(position) ?? '—'}</td>
                      <td style={CELL}>{freshnessLabel(position.age_seconds)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}

const CELL = { padding: 'var(--space-3)' } as const
