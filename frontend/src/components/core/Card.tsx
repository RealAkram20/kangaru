import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useIsCompact } from '../../lib/useMediaQuery'

type Tone = 'default' | 'accent' | 'sunken' | 'chrome'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Rendered in Sora SemiBold 20px inside a bordered header. */
  title?: string
  subtitle?: string
  /** Header-right slot — usually Buttons or IconButtons. */
  actions?: ReactNode
  /** none = flush content (tables, maps). sm = 16px. md = 24px (default). */
  padding?: 'none' | 'sm' | 'md'
  /** chrome = elevated navy card for use inside the sidebar/topbar. */
  tone?: Tone
  bodyStyle?: CSSProperties
  /**
   * Fill the height of the parent and let the body scroll instead of the page.
   *
   * The card becomes a flex column: header and footer keep their height, the
   * body takes what is left. Pair it with `PageFill.Flex` as the parent and a
   * scrolling child — `DataTable fill` — inside.
   *
   * Off by default, so no existing card changes shape.
   */
  fill?: boolean
  /**
   * Pinned below the body, inside the card's border.
   *
   * For the thing that must stay reachable while the body scrolls: a
   * "Load more", a row count, a total. Without this it scrolls away with the
   * content and the user has to travel back to it.
   */
  footer?: ReactNode
}

export function Card({
  children,
  title,
  subtitle,
  actions,
  padding = 'md',
  tone = 'default',
  style,
  bodyStyle,
  fill = false,
  footer,
  ...rest
}: CardProps) {
  const compact = useIsCompact()
  const pad = padding === 'none' ? 0 : padding === 'sm' ? 'var(--pad-card-compact)' : 'var(--pad-card)'
  const tones: Record<Tone, CSSProperties> = {
    default: { background: 'var(--surface-card)', border: '1px solid var(--border-default)' },
    accent: { background: 'var(--surface-accent)', border: '1px solid var(--kr-green-tint)' },
    sunken: { background: 'var(--surface-sunken)', border: '1px solid var(--border-default)' },
    chrome: { background: 'var(--surface-chrome-elevated)', border: '1px solid var(--border-chrome)' },
  }
  const onChrome = tone === 'chrome'
  return (
    <section
      style={{
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-xs)',
        overflow: 'hidden',
        ...(fill
          ? {
              // The card is the flex column; its body is the part that gives.
              // `minHeight: 0` so the body may shrink below its content and
              // hand the overflow to its own scroller rather than the page.
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }
          : null),
        ...tones[tone],
        ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            // Stacked on a phone, side by side on a desktop.
            //
            // It was `space-between` at every width with no wrap, so at 360px
            // the title column was squeezed to about 130px and "select a trip
            // to see its timeline" read one word per line beside a search box
            // running off the right edge.
            flexDirection: compact ? 'column' : 'row',
            alignItems: compact ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: compact ? 'var(--space-3)' : 'var(--space-4)',
            padding: `var(--space-4) ${padding === 'none' ? 'var(--space-4)' : pad}`,
            borderBottom: '1px solid ' + (onChrome ? 'var(--border-chrome)' : 'var(--border-default)'),
            // The header is the fixed part of a filling card — it holds the
            // title, the client filter and the search box, all of which used
            // to scroll away with the list.
            ...(fill ? { flexShrink: 0 } : null),
          }}
        >
          {/* `minWidth: 0` so a long title wraps instead of forcing the
              header wider than the card, which is what pushed the filters
              off-screen. */}
          <div style={{ minWidth: 0 }}>
            {title && (
              <h2
                style={{
                  font: 'var(--type-section-title)',
                  color: onChrome ? 'var(--text-on-chrome)' : 'var(--text-heading)',
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {title}
              </h2>
            )}
            {subtitle && (
              <p
                style={{
                  font: 'var(--type-body-dense)',
                  color: onChrome ? 'var(--text-on-chrome-secondary)' : 'var(--text-secondary)',
                  marginTop: 2,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--gap-inline)',
                // Filters and search wrap onto their own lines on a phone
                // rather than running off the edge, and each takes the full
                // width so a search box is a comfortable target rather than
                // a 90px sliver.
                flexWrap: 'wrap',
                ...(compact ? { flexDirection: 'column', alignItems: 'stretch' } : null),
              }}
            >
              {actions}
            </div>
          )}
        </header>
      )}
      <div
        style={{
          padding: pad,
          ...(fill
            ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
            : null),
          ...bodyStyle,
        }}
      >
        {children}
      </div>
      {/*
        Unstyled on purpose. `LoadMore` — the footer this exists for — already
        draws its own top rule and padding, and renders nothing at all on the
        last page. A border here would double that rule, and would leave an
        empty ruled strip on the last page, since the element stays truthy
        even when it renders null.
      */}
      {footer && <div style={{ flexShrink: 0 }}>{footer}</div>}
    </section>
  )
}
