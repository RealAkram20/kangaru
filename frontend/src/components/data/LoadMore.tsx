import { Button } from '../core/Button'

/**
 * The footer of a cursor-paginated list.
 *
 * Every listing in this application is cursor-paginated server-side
 * (AGENTS.md reserves cursors for append-heavy data, which trips, bookings
 * and the audit trail all are), so every one of them needs the same
 * control. This is that control, extracted the third time it was about to
 * be written — AGENTS.md: "If a component appears more than once, convert
 * it into a reusable component."
 *
 * Renders nothing at all when there is no next page, so a caller can mount
 * it unconditionally and let the cursor decide. A disabled "Load more" at
 * the end of a list invites a click that does nothing.
 *
 * Deliberately a button rather than infinite scroll. These are work
 * queues read by keyboard as often as by mouse, an operator needs a
 * predictable end to the list to reach what is under it, and scroll-driven
 * loading is hostile to both (AGENTS.md Frontend Standards: keyboard
 * friendly, and consistency over decoration).
 */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  label = 'Load more',
}: {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
  label?: string
}) {
  if (!hasMore) return null

  return (
    <div
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--border-default)',
      }}
    >
      <Button size="sm" variant="secondary" loading={loading} onClick={onLoadMore}>
        {label}
      </Button>
    </div>
  )
}
