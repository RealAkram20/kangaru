import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

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
  ...rest
}: CardProps) {
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
        ...tones[tone],
        ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            padding: `var(--space-4) ${padding === 'none' ? 'var(--space-4)' : pad}`,
            borderBottom: '1px solid ' + (onChrome ? 'var(--border-chrome)' : 'var(--border-default)'),
          }}
        >
          <div>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-inline)' }}>{actions}</div>
          )}
        </header>
      )}
      <div style={{ padding: pad, ...bodyStyle }}>{children}</div>
    </section>
  )
}
