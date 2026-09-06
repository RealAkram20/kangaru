import type { CSSProperties, ReactNode } from 'react'
import { useIsCompact } from '../../lib/useMediaQuery'

/**
 * A page that is exactly as tall as the pane it sits in, so that scrolling
 * happens *inside* a list rather than moving the whole page.
 *
 * `AppShell`'s `<main>` is already a scroller with a definite height, so a
 * child at `height: 100%` fills it exactly and leaves nothing for `<main>` to
 * scroll. That is the whole trick: pages that opt in stop growing, and the
 * card headers, filters and footers they contain stop travelling off-screen.
 *
 * Pages that do not opt in are untouched — `<main>` still scrolls them.
 *
 * Use it with exactly one `<PageFill.Flex>` child, which takes the leftover
 * height. Anything else — an alert, a docked detail panel — sits at its
 * natural height above or below it.
 *
 *   <PageFill>
 *     {notice && <Alert … />}
 *     <PageFill.Flex><Card fill>…</Card></PageFill.Flex>
 *     {selected && <DetailPanel … />}
 *   </PageFill>
 */
export function PageFill({
  children,
  gap = 'var(--space-4)',
  style,
}: {
  children: ReactNode
  gap?: string
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap,
        // Without this a flex column refuses to shrink below the intrinsic
        // height of its content, so the inner scroller never gets a bounded
        // height and the overflow reappears on the page. It is the single
        // line that makes the rest of this work.
        minHeight: 0,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/**
 * The child that absorbs the leftover height. Everything else in a `PageFill`
 * keeps its natural size, so when a detail panel docks below, this is what
 * gives up the room.
 *
 * `minHeight: 0` again, and for the same reason one level down.
 */
function Flex({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...style }}>
      {children}
    </div>
  )
}

/**
 * A region that keeps its own height but will not grow past `maxHeight`,
 * scrolling internally instead.
 *
 * For the docked detail panel: a trip with a forty-event timeline must not
 * push the list it belongs to off the screen. `45%` leaves the list the
 * majority of the viewport, which is the right way round — the panel is the
 * answer to a question the list is still asking.
 */
function Docked({
  children,
  maxHeight = '45%',
  style,
}: {
  children: ReactNode
  maxHeight?: string
  style?: CSSProperties
}) {
  const compact = useIsCompact()

  /*
    On a phone the dock becomes the whole pane.

    45% of an 800px screen is 360px, and after the panel's own header that
    leaves roughly two facts and one timeline entry — a detail panel that
    cannot show detail, sitting under a list squeezed to three cards. Neither
    half is usable. Giving the detail the full pane instead makes the choice
    honest: you are reading one record, and Close returns you to the list.
  */
  if (compact) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-page)',
          ...style,
        }}
      >
        {children}
      </div>
    )
  }

  return (
    <div style={{ flexShrink: 0, maxHeight, display: 'flex', flexDirection: 'column', ...style }}>
      {children}
    </div>
  )
}

PageFill.Flex = Flex
PageFill.Docked = Docked
