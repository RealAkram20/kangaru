import { Icon } from '../core/Icon'

/**
 * The button that puts the map back.
 *
 * Google's is the reference, and the reason it exists there is the reason it
 * exists here: **every map on this platform frames itself once and then
 * stops.** `FleetMap` fits the fleet on the first poll and deliberately
 * never re-fits, because dragging the viewport out from under a dispatcher
 * watching one junction — every ten seconds, forever — is worse than a map
 * that stays where it was put. `TripTraceMap` frames the trace it was given.
 * Both route maps frame the circuit while it is being built and then hand
 * control over.
 *
 * That is the right default in all four cases, and it leaves the same hole
 * in all four: once you have panned away, nothing brings you back. This is
 * what brings you back.
 *
 * ## Why a plain button and not a map control
 *
 * MapLibre and Google both take custom controls, and both would put this in
 * the top-right stack with the zoom buttons. Two things argued against it.
 * The console draws maps with **two different SDKs** — one control class
 * each, one look each, and the moment they drift a dispatcher is looking at
 * two different buttons for one action. And an imperative control cannot use
 * `Icon`, so the glyph would have to be inlined SVG in a codebase whose rule
 * is that icons come from Lucide by name.
 *
 * A positioned button over the container is neither of those problems, and
 * it is what the public order flow has drawn since it shipped — same shape,
 * same crosshair, same corner. One vocabulary for "put the map back",
 * whichever engine is underneath.
 *
 * ## Why it is always visible
 *
 * Google's appears only once you have moved off. That needs the map to
 * report every camera change and the button to appear under a cursor that is
 * already moving, and a control that comes and goes is a control nobody
 * learns is there. It costs one always-present button to be discoverable,
 * and pressing it on an already-framed map is a no-op the user can see is
 * safe.
 */
export function MapRecenterButton({
  onClick,
  label = 'Recentre the map',
}: {
  onClick: () => void
  /**
   * What it puts back, in words. The only label a screen reader gets — the
   * crosshair is the whole button — so it says the subject: "Show the whole
   * route", "Show the whole fleet".
   */
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        position: 'absolute',
        // Clear of the attribution pill, which every map here mounts
        // compact in this same corner. Sitting on top of it would hide the
        // one credit the basemap licence requires.
        insetBlockEnd: 44,
        insetInlineEnd: 10,
        zIndex: 2,
        display: 'grid',
        placeItems: 'center',
        width: 40,
        height: 40,
        padding: 0,
        borderRadius: '50%',
        // The base palette, not the semantic tokens, and this is the one
        // place in the app where that is right: every map here draws the
        // *light* basemap even when the OS asks for dark — `FleetMap` says
        // why, a grey stale marker vanishes into dark streets — and this
        // button sits directly under MapLibre's own zoom controls, which
        // are white on both themes. Following the theme made it the one
        // dark control in a light stack over a light map.
        border: '1px solid rgba(0, 16, 40, 0.14)',
        background: 'var(--kr-white)',
        color: 'var(--kr-navy)',
        boxShadow: 'var(--shadow-md)',
        cursor: 'pointer',
      }}
    >
      <Icon name="crosshair" size={18} aria-hidden />
    </button>
  )
}
