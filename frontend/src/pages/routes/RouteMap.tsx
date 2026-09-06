import { useCallback, useState } from 'react'
import { googleMapsAvailable } from '../public/googleMaps'
import { GoogleRouteMap } from './GoogleRouteMap'
import { LibreRouteMap } from './LibreRouteMap'
import type { DraftStop, DrawnRoute } from './routeBuilder'

/**
 * Which engine draws the circuit (ADR-0045).
 *
 * The same dual-engine shape `MapPanel` / `GoogleMapPanel` already use on
 * the public order flow, and for the same reason `frontend/.env.example`
 * gives: **the Google key is optional.** Google when it is configured,
 * because Kampala's branch and business names are Google places and the
 * officer is pinning branches; the keyless MapLibre/CARTO pair otherwise,
 * because a builder whose map is a grey box on every deployment that has
 * not bought a Directions plan is a broken screen, not a fallback.
 *
 * This was found by rendering rather than by testing: with no key in the
 * dev environment, the builder showed "The map is not available here" and
 * the whole visual half of a *visual* route builder was missing. The screen
 * degraded honestly and was still useless.
 *
 * `unsupported` covers the narrower case underneath — a key that exists and
 * a script that fails anyway. It latches, so a flaky load does not flip the
 * map back and forth between engines while somebody is dragging a pin.
 */
export interface RouteMapProps {
  stops: DraftStop[]
  drawn: DrawnRoute | null
  selectedKey: string | null
  onSelect: (key: string) => void
  onMoveStop: (key: string, latitude: number, longitude: number) => void
}

export function RouteMap(props: RouteMapProps) {
  const [unsupported, setUnsupported] = useState(false)
  const fall = useCallback(() => setUnsupported(true), [])

  if (!googleMapsAvailable() || unsupported) {
    return <LibreRouteMap {...props} />
  }

  return <GoogleRouteMap {...props} onUnsupported={fall} />
}
