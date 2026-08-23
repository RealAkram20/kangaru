import { isAxiosError } from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/core/Badge'
import { Icon } from '../components/core/Icon'
import { Identifier } from '../components/core/Identifier'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { ClientFilterSelect } from '../components/filters/ClientFilterSelect'
import { Checkbox } from '../components/forms/Checkbox'
import { Input } from '../components/forms/Input'
import { FleetMap } from '../components/map/FleetMap'
import { useIsCompact } from '../lib/useMediaQuery'
import { overlaySummary, routePins } from '../lib/routeOverlay'
import type { ClientRoute } from './routes/routeBuilder'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import {
  buildUnits,
  KAMPALA,
  nearbyToUnits,
  byAttention,
  freshnessLabel,
  matchesFilter,
  matchesQuery,
  POLL_MS,
  speedLabel,
  statusIcon,
  statusLabel,
  summarise,
  toneFor,
  unitTitle,
  type FleetUnit,
  type UnitFilter,
} from '../lib/livePositions'
import type { ApiSuccess, FilterOption, TenancyScope } from '../types/api'
import type { LivePosition, NearbyVehicle, OnDutyDriver } from '../types/livePosition'

/**
 * Where the fleet is right now (ADR-0019 + ADR-0024 §2) — the dispatcher's
 * working surface, not a report.
 *
 * Two reads, merged into one picture. `GET /live-positions` is the vehicles
 * on a trip; `GET /driver-presence` is the pool waiting for one. A
 * dispatcher deciding whether a walk-in will be picked up needs both on the
 * same map: the blue arrows are capacity spent, the green dots are capacity
 * left, and the grey dots are the calls to make. Both endpoints are scoped
 * server-side — the trips read through `Trip::forActor`, the pool behind
 * `drivers.view` — so this page filters nothing for safety, only for focus.
 *
 * A corporate client's user never sees the pool *named*: `/driver-presence`
 * answers them 403 (the riders are Shanitah's, security-gate F2), the page
 * stops asking, and switches to `GET /public/nearby-vehicles` — the same
 * anonymized read the order page's ambient fleet draws from. They see that
 * capacity exists ("Boda · Waiting for work") beside their own rides,
 * and nothing that joins back to the register. No role is sniffed
 * client-side; the server's refusal is the switch.
 *
 * ## Polling, and why the tab matters
 *
 * ADR-0019 chose polling and named broadcasting over Reverb as the better
 * answer it deliberately defers. So: one request pair every `POLL_MS`, and
 * **nothing at all while the tab is hidden**. A dispatcher leaves this open
 * all day behind other windows; without that check, 200 dashboards would
 * spend the whole night asking where a fleet that stopped at six is.
 *
 * The first paint after returning to the tab is immediate rather than one
 * interval late, because coming back to a map showing where things were ten
 * seconds ago is exactly when it is most misleading.
 */
export function LiveMapPage() {
  const compact = useIsCompact()
  const [positions, setPositions] = useState<LivePosition[] | null>(null)
  const [onDuty, setOnDuty] = useState<OnDutyDriver[]>([])
  const [nearby, setNearby] = useState<NearbyVehicle[]>([])
  const [scope, setScope] = useState<TenancyScope>('tenant')
  const [clients, setClients] = useState<FilterOption[]>([])
  const [client, setClient] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<UnitFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  /*
   * ADR-0045: the client's planned circuits, as a layer under the fleet.
   *
   * Fetched **once, outside the poll**, and that is the whole cost story: a
   * route changes when somebody edits it, which is rarely, while positions
   * change every ten seconds. Folding this into `load()` would multiply a
   * rarely-changing read by 360 an hour for nothing.
   *
   * A refusal is silence rather than an error banner. `routes.view` is not
   * on every role that can open this page — a Fleet Owner holds neither —
   * and a dispatcher watching vehicles should not be told off about a layer
   * they were not looking for.
   */
  const [routes, setRoutes] = useState<ClientRoute[]>([])
  const [showRoutes, setShowRoutes] = useState(true)

  useEffect(() => {
    let cancelled = false

    void apiClient
      .get<ApiSuccess<ClientRoute[]>>('/routes')
      .then((response) => {
        if (!cancelled) setRoutes(response.data.data)
      })
      .catch(() => {
        if (!cancelled) setRoutes([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Memoised because it is a `FleetMap` dependency: a fresh array every
  // render would rebuild every site marker on every ten-second poll.
  const pins = useMemo(() => (showRoutes ? routePins(routes) : []), [routes, showRoutes])
  const routeSummary = overlaySummary(routes)

  // Set once, when `/driver-presence` answers 403: this caller may not read
  // the pool, and asking again every ten seconds would be 8,640 refusals a
  // day, logged as if something were wrong.
  const poolRefused = useRef(false)

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

      const trips = apiClient
        .get<ApiSuccess<LivePosition[], { scope?: TenancyScope; filters?: { clients: FilterOption[] } }>>(
          client === '' ? '/live-positions' : `/live-positions?tenant_id=${client}`,
        )
        .then((response) => {
          if (!live || mine !== latest) return
          setPositions(response.data.data)
          setScope(response.data.meta?.scope ?? 'tenant')
          setClients(response.data.meta?.filters?.clients ?? [])
          setError(null)
        })

      // The pool is not narrowed by the client filter, deliberately: a
      // waiting driver is shared capacity, not any client's. It is also
      // best-effort — a page that loses the pool still shows the trips.
      //
      // Refused once (a client's user), the page switches to the public
      // anonymized read for good: the same vehicles as dots and
      // categories, nothing as names. Centred on the city — "is there
      // capacity out there" is a service-area question, not a viewport one.
      const nearbyInstead = () =>
        apiClient
          .get<ApiSuccess<NearbyVehicle[]>>(
            `/public/nearby-vehicles?latitude=${KAMPALA[1]}&longitude=${KAMPALA[0]}`,
          )
          .then((response) => {
            if (!live || mine !== latest) return
            setNearby(response.data.data)
          })

      const pool = poolRefused.current
        ? nearbyInstead()
        : apiClient
            .get<ApiSuccess<OnDutyDriver[]>>('/driver-presence')
            .then((response) => {
              if (!live || mine !== latest) return
              setOnDuty(response.data.data)
            })
            .catch((failure: unknown) => {
              if (isAxiosError(failure) && failure.response?.status === 403) {
                poolRefused.current = true
                return nearbyInstead()
              }
              throw failure
            })

      return Promise.all([trips, pool]).catch((failure: unknown) => {
        if (!live || mine !== latest) return
        // Deliberately does not clear what is drawn. A dropped request is
        // not evidence the fleet vanished, and blanking the map on every
        // blip would make it useless on a bad connection — a dispatcher
        // reads a blank map as "everything stopped". The banner says the
        // refresh failed; the markers stay, and their own age will start
        // reading stale if it persists.
        setError(apiError(failure, 'Could not refresh the map.').message)
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
  }, [client])

  const units = useMemo(
    () => [...buildUnits(positions ?? [], onDuty), ...nearbyToUnits(nearby)].sort(byAttention),
    [positions, onDuty, nearby],
  )

  const counts = useMemo(() => summarise(units), [units])

  const shown = useMemo(
    () => units.filter((u) => matchesFilter(u, filter) && matchesQuery(u, query)),
    [units, filter, query],
  )

  const onSelect = useCallback((key: string) => {
    setSelected((current) => (current === key ? null : key))
  }, [])

  // Nothing at all until the first answer: a map with no markers reads as
  // "the fleet is idle", which the first response may contradict.
  if (positions === null && error === null) {
    return null
  }

  const chips: { value: UnitFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: units.length },
    { value: 'on_trip', label: 'On a trip', count: counts.onTrip },
    { value: 'waiting', label: 'Waiting', count: counts.waiting },
    { value: 'stale', label: 'Not reporting', count: counts.stale },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error !== null && (
        <Alert tone="warning" title="The map may be out of date" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/*
        Side by side on a desktop, map above list on a phone.

        The fleet panel is a fixed 384px that will not shrink, so in a
        horizontal flex at 360px it took the whole pane and the map's `flex: 1`
        collapsed to zero width — the page rendered as a fleet list with no
        map at all, which is the one thing this page exists to show.
      */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
          gap: 'var(--space-4)',
        }}
      >
        {/* The map is the page. It is always drawn — an empty fleet is an
            empty map of Kampala, not a card where a map should be. */}
        <section
          aria-label="Fleet map"
          style={{
            // Slightly more than half the pane on a phone, and not `flex: 1`:
            // the map has no intrinsic height, so in a column it would resolve
            // to nothing and disappear again for a different reason.
            ...(compact ? { flex: '0 0 55%', minHeight: 240 } : { flex: 1, minWidth: 0 }),
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-card)',
            overflow: 'hidden',
          }}
        >
          <FleetMap units={units} selected={selected} onSelect={onSelect} routePins={pins} />
        </section>

        <section
          aria-label="Vehicles and drivers"
          style={{
            // Full width under the map on a phone; the fixed rail beside it
            // on a desktop.
            ...(compact
              ? { width: '100%', flex: 1 }
              : { width: 384, flexShrink: 0 }),
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-card)',
          }}
        >
          <header
            style={{
              padding: 'var(--space-4)',
              borderBottom: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <div>
                <h2 style={{ font: 'var(--type-section-title)', color: 'var(--text-heading)', margin: 0 }}>
                  Fleet
                </h2>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {counts.onTrip} on a trip · {counts.waiting} waiting
                  {counts.stale > 0 ? ` · ${counts.stale} not reporting` : ''}
                </p>
              </div>
              <ClientFilterSelect scope={scope} clients={clients} value={client} onChange={setClient} width={150} />
            </div>

            <Input
              aria-label="Search the fleet"
              placeholder="Plate, driver, client or trip…"
              iconLeft="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {/* ADR-0045. Only offered when there is something to show: a dead
                toggle on a client with no routes is a control that teaches
                the dispatcher this page has a feature they cannot use. The
                caption says "planned", because that is what it is — trips
                carry no stops yet, so nothing here reports progress. */}
            {routeSummary !== null && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  font: 'var(--type-body)',
                  color: 'var(--text-body)',
                  cursor: 'pointer',
                }}
              >
                <Checkbox
                  checked={showRoutes}
                  onChange={(event) => setShowRoutes(event.target.checked)}
                />
                <span>
                  Planned route sites
                  <span
                    style={{
                      display: 'block',
                      font: 'var(--type-caption)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {routeSummary}
                  </span>
                </span>
              </label>
            )}

            <div role="group" aria-label="Show" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {chips.map((chip) => {
                const active = filter === chip.value
                return (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(chip.value)}
                    style={{
                      font: 'var(--type-label)',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-pill)',
                      cursor: 'pointer',
                      border: `1px solid ${active ? 'var(--kr-green-dark)' : 'var(--border-default)'}`,
                      background: active ? 'var(--kr-green-tint)' : 'transparent',
                      color: active ? 'var(--kr-green-dark)' : 'var(--text-secondary)',
                      transition: 'var(--transition-control)',
                    }}
                  >
                    {chip.label} {chip.count}
                  </button>
                )
              })}
            </div>
          </header>

          <div role="list" aria-label="Fleet list" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {shown.length === 0 ? (
              <EmptyState
                icon="map-pin-off"
                title={units.length === 0 ? 'Nothing is out there' : 'Nothing matches'}
                description={
                  units.length === 0
                    ? 'Vehicles appear when a trip is under way; drivers appear when they go on duty.'
                    : 'No vehicle or driver matches this filter and search.'
                }
              />
            ) : (
              shown.map((unit) => (
                <UnitRow
                  key={unit.key}
                  unit={unit}
                  selected={selected === unit.key}
                  onSelect={() => onSelect(unit.key)}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * One row: who, what they are doing, how fresh. Selecting it flies the map
 * there and unfolds the details — the same act a marker click performs, so
 * the two surfaces stay interchangeable.
 */
function UnitRow({ unit, selected, onSelect }: { unit: FleetUnit; selected: boolean; onSelect: () => void }) {
  const tone = toneFor(unit)
  const badgeTone = tone === 'stale' ? 'neutral' : tone === 'waiting' ? 'success' : 'info'
  const speed = speedLabel(unit)

  return (
    <div role="listitem" style={{ borderTop: '1px solid var(--border-default)' }}>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          width: '100%',
          textAlign: 'left',
          padding: 'var(--space-3) var(--space-4)',
          border: 'none',
          cursor: 'pointer',
          background: selected ? 'var(--surface-accent)' : 'transparent',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {unit.plate !== null ? (
              <Identifier kind="plate" size="xs">
                {unit.plate}
              </Identifier>
            ) : (
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-body)' }}>
                {unitTitle(unit)}
              </span>
            )}
            {unit.plate !== null && unit.driverName !== null && (
              <span
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-body)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {unit.driverName}
              </span>
            )}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {freshnessLabel(unit.ageSeconds)}
            {speed !== null ? ` · ${speed}` : ''}
            {unit.clientName !== null ? ` · ${unit.clientName}` : ''}
          </div>
        </div>
        <Badge tone={badgeTone} icon={statusIcon(unit)} size="sm">
          {statusLabel(unit)}
        </Badge>
      </button>

      {selected && <UnitDetail unit={unit} />}
    </div>
  )
}

/** The unfolded facts for the selected unit — only what the platform has. */
function UnitDetail({ unit }: { unit: FleetUnit }) {
  return (
    <div
      style={{
        padding: '0 var(--space-4) var(--space-3)',
        background: 'var(--surface-accent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-body)',
      }}
    >
      {unit.vehicleName !== null && (
        <Fact icon="car" label="Vehicle" value={unit.vehicleName} />
      )}
      {(unit.origin !== null || unit.destination !== null) && (
        <Fact icon="route" label="Route" value={`${unit.origin ?? '—'} → ${unit.destination ?? '—'}`} />
      )}
      {unit.kind === 'on_trip' && (
        <Fact icon="briefcase" label="For" value={unit.clientName ?? 'Walk-in'} />
      )}
      {unit.latitude === null && (
        // Not an error — a fact. Location can be refused on a handset that
        // is otherwise working, and the driver still gets work (ADR-0024).
        <Fact icon="map-pin-off" label="Position" value="Never reported — nothing to draw" />
      )}
      {unit.source === 'handset' && unit.kind === 'on_trip' && unit.latitude !== null && (
        // Say where the dot came from when it is not the vehicle: the
        // handset heartbeat is a coarser, slower signal than the trip's GPS
        // stream, and a dispatcher should not read it with the same trust.
        <Fact icon="smartphone" label="Position" value="From the driver's handset" />
      )}

      {unit.tripId !== null && (
        <Link
          to={`/trips/${unit.tripId}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            color: 'var(--text-link)',
            fontWeight: 'var(--weight-medium)',
            textDecoration: 'none',
            width: 'fit-content',
          }}
        >
          <Icon name="arrow-up-right" size={14} />
          Open trip #{unit.tripId}
        </Link>
      )}
    </div>
  )
}

function Fact({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
      <Icon name={icon} size={14} style={{ color: 'var(--text-secondary)', alignSelf: 'center', flexShrink: 0 }} />
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span style={{ overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}
