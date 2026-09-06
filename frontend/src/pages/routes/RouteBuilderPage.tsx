import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Icon } from '../../components/core/Icon'
import { Alert } from '../../components/feedback/Alert'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { PlaceHit } from '../public/places'
import './routeBuilder.css'
import { AddStopField } from './AddStopField'
import { RouteMap } from './RouteMap'
import { useIsCompact } from '../../lib/useMediaQuery'
import { StopRail } from './StopRail'
import {
  NO_FIGURE,
  canDraw,
  distanceLabel,
  draftStop,
  durationParts,
  placeIds,
  summaryLine,
  toDraft,
  whyNoLine,
  type ClientPlace,
  type ClientRoute,
  type DraftStop,
  type DrawnRoute,
} from './routeBuilder'

/**
 * The visual route builder (ADR-0045).
 *
 * A corporate client's officer pins their ATM estate and drags it into the
 * order the cash run is driven. Three surfaces, one state: the itinerary
 * rail, the map beside it, and the totals above both.
 *
 * ## The line is asked for, not computed
 *
 * `POST /routes/preview` draws it, because ADR-0031 §1 keeps the Directions
 * credential on the server — it bills per request and a key in this bundle
 * would be extractable with nothing to rotate. Two consequences the code
 * below is shaped by:
 *
 * 1. **The ask is debounced and only fires on a settled list.** A drag in
 *    progress is not a question; the answer is wanted when the officer lets
 *    go. `RouteService` also caches five minutes on the points themselves,
 *    so fiddling with one stop costs one request rather than forty.
 * 2. **A null answer is a real answer.** Routing is off by default, and a
 *    provider may decline. Then there is no line and no distance — an em
 *    dash and a sentence saying which of the three reasons applies
 *    (`whyNoLine`), never a straight line between the pins and never a
 *    crow's-flight kilometre figure.
 */
export function RouteBuilderPage() {
  const compact = useIsCompact()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const editing = id !== undefined && id !== 'new'

  const [name, setName] = useState('')
  const [reference, setReference] = useState('')
  const [stops, setStops] = useState<DraftStop[]>([])
  const [places, setPlaces] = useState<ClientPlace[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  /**
   * The last answer, tagged with the circuit it describes.
   *
   * Tagged rather than tracked with a sequence counter, because "is this
   * answer about what is on screen now" is the only question either
   * mechanism was ever asking — and a shape tag answers it without a second
   * piece of state that can disagree with the first. `drawn` and `drawing`
   * below are both derived from it, so there is no state to synchronise in
   * an effect and no frame where a stale line is drawn under a fresh list.
   */
  const [preview, setPreview] = useState<{ shape: string; route: DrawnRoute | null } | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const register = await apiClient.get<ApiSuccess<ClientPlace[]>>('/places')
        if (cancelled) return
        setPlaces(register.data.data)

        if (editing) {
          const route = await apiClient.get<ApiSuccess<ClientRoute>>(`/routes/${id}`)
          if (cancelled) return
          setName(route.data.data.name)
          setReference(route.data.data.reference ?? '')
          setStops(toDraft(route.data.data.stops ?? []))
        }
      } catch (failure) {
        if (!cancelled) setError(apiError(failure, 'This route could not be opened.').message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [editing, id])

  /*
   * Redraw when the *shape* changes, and not while a drag is mid-flight.
   *
   * The dependency is the ordered id list rather than `stops`, deliberately:
   * renaming the route, or editing a stop's dwell minutes, changes `stops`
   * by identity and changes the drive not at all. Keying on the ids means
   * those edits cost nothing.
   */
  const shape = placeIds(stops).join(',')

  // Both derived, so neither can be stale: a line is only shown for the
  // circuit currently on screen, and anything else reads as still measuring.
  const drawn = preview !== null && preview.shape === shape ? preview.route : null
  const drawing = canDraw(stops) && preview?.shape !== shape

  useEffect(() => {
    const ids = shape === '' ? [] : shape.split(',').map(Number)

    if (ids.length < 2) return

    const timer = setTimeout(() => {
      void apiClient
        .post<ApiSuccess<DrawnRoute | null>>('/routes/preview', { place_ids: ids })
        .then((response) => setPreview({ shape, route: response.data.data }))
        // Not surfaced as an error banner: a route that cannot be drawn is
        // still a route that can be saved, and `whyNoLine` already says so
        // where the missing figure is.
        .catch(() => setPreview({ shape, route: null }))
    }, 400)

    return () => clearTimeout(timer)
  }, [shape])

  const addSaved = (place: ClientPlace) => setStops((current) => [...current, draftStop(place)])

  /**
   * A geocoder hit becomes a saved place first, then a stop.
   *
   * Pinning it is not an extra step the officer asked for — it is what makes
   * the ATM appear in next month's search, and what lets a report group
   * spend by site. The stop only lands if the place saved, because a stop
   * refers to a `client_place_id` and there is nothing else for it to be.
   */
  const addNew = async (hit: PlaceHit & { lngLat: [number, number] }) => {
    try {
      const created = await apiClient.post<ApiSuccess<ClientPlace>>('/places', {
        name: hit.name,
        address: hit.detail === '' ? null : hit.detail,
        latitude: hit.lngLat[1],
        longitude: hit.lngLat[0],
      })

      setPlaces((current) => [...current, created.data.data])
      setStops((current) => [...current, draftStop(created.data.data)])
    } catch (failure) {
      setError(apiError(failure, 'That place could not be saved.').message)
    }
  }

  /** A pin dragged on the map moves the place itself, for every route on it. */
  const moveStop = useCallback(
    async (key: string, latitude: number, longitude: number) => {
      const stop = stops.find((candidate) => candidate.key === key)
      if (stop === undefined) return

      const moved = { ...stop.place, latitude, longitude }

      // Optimistic, and safe to be: the failure path puts it back and says
      // why, and the officer is watching the pin they just dragged.
      setStops((current) =>
        current.map((c) => (c.place.id === stop.place.id ? { ...c, place: moved } : c)),
      )
      setPlaces((current) => current.map((p) => (p.id === moved.id ? moved : p)))

      try {
        await apiClient.patch(`/places/${moved.id}`, { latitude, longitude })
      } catch (failure) {
        setStops((current) =>
          current.map((c) => (c.place.id === stop.place.id ? { ...c, place: stop.place } : c)),
        )
        setPlaces((current) => current.map((p) => (p.id === stop.place.id ? stop.place : p)))
        setError(apiError(failure, 'That pin could not be moved.').message)
      }
    },
    [stops],
  )

  const save = async () => {
    setSaving(true)
    setError(null)

    const body = {
      name,
      reference: reference === '' ? null : reference,
      stops: stops.map((stop) => ({
        client_place_id: stop.place.id,
        expected_dwell_minutes: stop.expected_dwell_minutes,
        driver_notes: stop.driver_notes,
      })),
    }

    try {
      if (editing) {
        await apiClient.patch(`/routes/${id}`, body)
      } else {
        await apiClient.post('/routes', body)
      }
      navigate('/routes')
    } catch (failure) {
      setError(apiError(failure, 'This route could not be saved.').message)
    } finally {
      setSaving(false)
    }
  }

  const reason = whyNoLine(stops, drawing, drawn)

  if (loading) {
    return <Card>Loading…</Card>
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {error !== null && (
        <Alert tone="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div
        style={{
          display: 'grid',
          // The rail is a fixed reading column; the map takes what is left.
          // Below the breakpoint they stack, map first — a builder on a laptop
          // in a meeting room is the real second case here.
          //
          // Set here rather than left to `.kr-route-builder`'s media query:
          // this inline value overrode that rule, so on a 360px screen the
          // two columns survived and the rail — asked for `minmax(320px, …)`
          // in 312px of space — was crushed to 2px wide beside the map.
          gridTemplateColumns: compact ? '1fr' : 'minmax(320px, 360px) 1fr',
          gap: 'var(--space-4)',
          alignItems: 'start',
        }}
        className="kr-route-builder"
      >
        <Card padding="sm">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <FormField label="Route name" htmlFor="route-name" required>
              <Input
                id="route-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Kampala Central ATM Run"
              />
            </FormField>

            <FormField label="Your reference" htmlFor="route-reference" hint="Optional.">
              <Input
                id="route-reference"
                value={reference}
                mono
                onChange={(event) => setReference(event.target.value)}
                placeholder="CB/ATM/CENTRAL"
              />
            </FormField>

            {/* Three equal columns rather than a flex row: at 360px the row
                was wrapping "4.6 km" onto three lines and letting the widest
                figure squeeze the other two. A grid gives each the same
                third and lets the text wrap inside its own cell. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                background: 'var(--surface-sunken)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <Figure label="Stops" value={String(stops.length)} />
              <Figure label="Road distance" value={distanceLabel(drawn)} />
              <Figure label="Driving time" {...durationParts(drawn)} />
            </div>

            {reason !== null && (
              <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                {reason}
              </p>
            )}

            <StopRail
              stops={stops}
              disabled={saving}
              onChange={setStops}
              onRemove={(key) => setStops((current) => current.filter((s) => s.key !== key))}
            />

            <AddStopField
              places={places}
              disabled={saving}
              onAddSaved={addSaved}
              onAddNew={(hit) => void addNew(hit)}
            />

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button onClick={() => void save()} loading={saving} disabled={name.trim() === ''}>
                {editing ? 'Save route' : 'Create route'}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/routes')} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>

        {/*
          The map fills the screen on a phone.

          `routeBuilder.css` already meant to give it 320px below 1024px, but
          this inline `height` overrode it, so that rule never applied and the
          map sat at `min(72vh, 640px)` with dead space beneath it. Filling the
          pane is the better answer anyway: the map *is* the route view on a
          phone, and the stop rail is one scroll below it.

          `dvh`, not `vh`: on mobile Safari and Chrome `vh` is the viewport
          with the browser chrome *retracted*, so a `100vh` element is taller
          than what you can see and its bottom edge hides behind the URL bar.
        */}
        <Card
          padding="none"
          style={{
            height: compact
              ? 'calc(100dvh - var(--topbar-h) - (var(--space-6) * 2))'
              : 'min(72vh, 640px)',
          }}
          bodyStyle={{ height: '100%' }}
        >
          <RouteMap
            stops={stops}
            drawn={drawn}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onMoveStop={(key, lat, lng) => void moveStop(key, lat, lng)}
          />
        </Card>
      </div>

      <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
        <Icon name="route" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        {summaryLine(stops, drawn)}
      </p>
    </div>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ font: 'var(--type-overline)', color: 'var(--text-secondary)' }}>{label}</div>
      <div
        style={{
          // Section-title rather than `--type-kpi`: three figures share a
          // 360px rail here, and the KPI scale is built for a dashboard tile
          // that owns its own card.
          font: 'var(--type-section-title)',
          color: value === NO_FIGURE ? 'var(--text-placeholder)' : 'var(--text-heading)',
        }}
      >
        {value}
      </div>
      {note !== undefined && note !== null && (
        <div style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{note}</div>
      )}
    </div>
  )
}
