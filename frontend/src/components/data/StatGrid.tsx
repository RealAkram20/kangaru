import type { CSSProperties, ReactNode } from 'react'
import { useIsCompact } from '../../lib/useMediaQuery'

/**
 * The row of `KPIStat` tiles at the top of a dashboard.
 *
 * Extracted because both dashboards had one and neither survived a phone:
 * the client's was `repeat(auto-fit, minmax(200px, 1fr))`, which needs 416px
 * for two columns and so stacked every tile full width down a 360px screen;
 * the platform's was a hard `repeat(3, 1fr)`, which kept three columns of
 * 93px each.
 *
 * On a phone the tiles pair. Two short figures — 11 completed, 100% — reading
 * side by side is the whole point of a stat row, and one per row turns five
 * tiles into most of a screen's scrolling.
 *
 * A tile whose value will not fit half a phone screen opts out with
 * `<KPIStat wide>`: "UGX 12,761,700" is 30px Sora Bold and wants about 240px
 * against the ~148px a half column offers, so pairing it would wrap a headline
 * figure onto two lines. Short metrics pair, money spans.
 */
export function StatGrid({
  children,
  /** Desktop column count. 3 suits a five-tile row; pass 4 for a denser one. */
  columns = 3,
  style,
  ...rest
}: {
  children: ReactNode
  columns?: number
  style?: CSSProperties
} & Omit<React.HTMLAttributes<HTMLElement>, 'style' | 'children'>) {
  const compact = useIsCompact()

  return (
    /*
      A `section`, not a `div`.

      Both dashboards labelled their stat row (`aria-label="This month"`), and
      a labelled `section` carries the implicit `region` landmark — which is
      how a screen-reader user jumps to the figures instead of walking five
      tiles. Extracting this as a `div` silently dropped that landmark; the
      dashboard's own tests query `role="region"` and caught it.
    */
    <section
      style={{
        display: 'grid',
        // `minmax(0, 1fr)` rather than `1fr`: a long unbroken value would
        // otherwise raise the track's min-content width and push the grid
        // wider than the screen.
        gridTemplateColumns: compact
          ? 'repeat(2, minmax(0, 1fr))'
          : `repeat(${columns}, minmax(0, 1fr))`,
        gap: 'var(--space-4)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </section>
  )
}
