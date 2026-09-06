import './routeFallback.css'

/**
 * What fills the content area while a lazily-loaded route's chunk arrives.
 *
 * Every page is code-split (`routes/router.tsx`), so navigating to a screen
 * for the first time in a session fetches its JavaScript. Rendering `null`
 * for that gap is what the app used to do while auth resolved, and it read as
 * a broken screen. Bars in the page's own surface colour read as "arriving".
 *
 * Deliberately not a spinner: a spinner claims the wait is long enough to
 * need reassurance, and this one usually is not.
 */
export function RouteFallback() {
  return (
    <div className="route-fallback" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="route-fallback__bar" style={{ height: 28, width: '30%' }} />
      <div className="route-fallback__bar" style={{ height: 96 }} />
      <div className="route-fallback__bar" style={{ height: 240 }} />
    </div>
  )
}
