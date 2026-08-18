import { useEffect, type HTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../core/Icon'

/**
 * Ported from `KangaruRide Design System/components/feedback/Dialog.jsx`,
 * with Escape-to-close and body scroll locking added — the design-system
 * preview harness had no need for either, a real app does.
 */
export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open?: boolean
  title?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  onClose?: () => void
  width?: number
  tone?: 'default' | 'warning' | 'destructive'
}

export function Dialog({
  open = true,
  title,
  description,
  children,
  footer,
  onClose,
  width = 520,
  tone = 'default',
  style,
  ...rest
}: DialogProps) {
  useEffect(() => {
    if (!open || !onClose) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
        zIndex: 60,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          /*
           * **Never taller than the overlay lets it be.**
           *
           * Without this a tall dialog grew past the viewport, and because the
           * overlay is `position: fixed` with `overflow: hidden` below, the
           * overflowing part was simply unreachable — no page scroll, no
           * dialog scroll, and the footer's Save button off-screen. The rate
           * card version form (six vehicle categories, five amounts each) hit
           * it first, but every dialog in the app was one long form away from
           * the same trap.
           *
           * `100%`, not a viewport calculation: the overlay is a flex
           * container at `inset: 0` with its own padding, so a percentage
           * resolves against exactly the space the dialog is allowed — and it
           * stays correct if that padding ever changes.
           */
          maxHeight: '100%',
          // The panel becomes the column; the body below is the only part
          // that scrolls, so the header and the footer's buttons stay put.
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-card)',
          borderRadius: 'var(--radius-modal)',
          boxShadow: 'var(--shadow-modal)',
          // Kept, so the corners still clip their children.
          overflow: 'hidden',
          ...style,
        }}
        {...rest}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
            padding: 'var(--space-6) var(--space-6) var(--space-4)',
            // The title and the close button never scroll away.
            flex: '0 0 auto',
          }}
        >
          {tone !== 'default' && (
            <span
              style={{
                width: 36,
                height: 36,
                flex: '0 0 auto',
                borderRadius: 'var(--radius-pill)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: tone === 'destructive' ? 'var(--kr-error-tint)' : 'var(--kr-warning-tint)',
                color: tone === 'destructive' ? 'var(--kr-error)' : 'var(--kr-warning)',
              }}
            >
              <Icon name="triangle-alert" size={18} />
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && (
              <h2
                style={{
                  font: 'var(--type-section-title)',
                  color: 'var(--text-heading)',
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {title}
              </h2>
            )}
            {description && (
              <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)', marginTop: 6 }}>
                {description}
              </p>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: 2,
              }}
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        {children && (
          <div
            style={{
              padding: '0 var(--space-6) var(--space-6)',
              // The one scrolling region. `minHeight: 0` is what actually
              // makes it work: a flex item's default `min-height: auto`
              // refuses to shrink below its content, so the panel would grow
              // past `maxHeight` and clip exactly as before.
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
              // The page behind is scroll-locked while a dialog is open;
              // without this, reaching the end of the dialog would chain the
              // gesture to a body that cannot move, which reads as the scroll
              // being stuck.
              overscrollBehavior: 'contain',
            }}
          >
            {children}
          </div>
        )}
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--gap-inline)',
              padding: 'var(--space-4) var(--space-6)',
              background: 'var(--surface-sunken)',
              borderTop: '1px solid var(--border-default)',
              // Pinned. The primary action must be reachable without scrolling
              // a long form to the bottom to find it.
              flex: '0 0 auto',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
