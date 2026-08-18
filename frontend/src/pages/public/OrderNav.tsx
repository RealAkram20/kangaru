import { Link } from 'react-router-dom'

/**
 * Mobile: the mockup's floating rounded header card over the map.
 * Desktop: the ordinary full-width sticky bar.
 *
 * `desktopOnly` is for screens that own the top of the phone themselves —
 * the matching screen puts a floating round control there instead, and two
 * pieces of chrome stacked in the same corner is how you lose the map.
 */
export function OrderNav({
  desktopOnly = false,
  cancelLabel = 'Cancel',
}: {
  desktopOnly?: boolean
  cancelLabel?: string
}) {
  return (
    <header
      className={`z-40 border-border bg-surface-card lg:sticky lg:inset-x-0 lg:top-0 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:border-b lg:bg-surface-page/90 lg:shadow-none lg:backdrop-blur ${
        desktopOnly
          ? 'hidden lg:block'
          : 'fixed inset-x-4 top-4 rounded-2xl border shadow-md'
      }`}
    >
      <div className="flex h-14 items-center justify-between px-4 lg:h-16 lg:px-10">
        <Link to="/" className="flex items-center gap-2">
          <img src="/assets/logo-mark.png" alt="" className="h-7 w-7" />
          <span className="font-display font-bold text-text-heading">
            Kangaru<span className="text-brand-green">Ride</span>
          </span>
        </Link>
        <Link
          to="/"
          className="text-sm text-text-secondary transition-colors hover:text-text-heading"
        >
          {cancelLabel}
        </Link>
      </div>
    </header>
  )
}
