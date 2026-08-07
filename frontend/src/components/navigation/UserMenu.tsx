import { useEffect, useRef, useState } from 'react'
import { Icon } from '../core/Icon'

export interface UserMenuProps {
  name: string
  /** Optional, matching `TopbarUser` — an account may have no role label. */
  role?: string
  email?: string
  /** Two letters; derived from the name when absent. */
  initials?: string
  onProfile: () => void
  onSignOut: () => void
}

/**
 * The account menu behind the Topbar avatar.
 *
 * The avatar has always looked like a control — a filled circular pill with
 * initials — and was a plain `<span>` with no handler, no keyboard
 * affordance and nothing behind it. Every convention says that thing opens
 * something, so it now does.
 *
 * It gathers three things that were scattered or unreachable: who you are
 * signed in as, your own `/profile` (which had no navigation entry at all
 * and was reachable only by typing the URL), and signing out (a loose button
 * beside the avatar).
 *
 * ## Accessibility, deliberately not deferred
 *
 * A menu built from a `div` and a click handler is the usual way this
 * regresses AGENTS.md's "keyboard navigation, visible focus states". So:
 * the trigger is a real `<button>` carrying `aria-haspopup` and
 * `aria-expanded`, the surface is `role="menu"` over `role="menuitem"`
 * buttons, Escape closes it, a click outside closes it, and closing returns
 * focus to the trigger rather than dropping it on `<body>` — which is what
 * strands a keyboard user at the top of the document.
 */
export function UserMenu({ name, role, email, initials, onProfile, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Focus goes back where it came from. Without this the next Tab
      // starts from the document, which for a menu near the end of the
      // chrome means walking the entire page again.
      triggerRef.current?.focus()
    }

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  // Chosen once per action rather than repeated at both call sites: every
  // item closes the menu, and one that forgot would leave it hanging over
  // the page it just navigated to.
  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  const shown = initials || (name || '?').slice(0, 2).toUpperCase()

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-1) var(--space-2)',
          background: open ? 'var(--surface-on-chrome-hover)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--action-primary)',
            color: 'var(--text-on-brand)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: 'var(--type-label)',
            fontWeight: 'var(--weight-semibold)',
            flexShrink: 0,
          }}
        >
          {shown}
        </span>
        {/* Hidden on narrow chrome, where the avatar alone has to carry it. */}
        <span className="kr-user-menu-identity" style={{ lineHeight: 1.2, textAlign: 'left' }}>
          <span
            style={{ display: 'block', font: 'var(--type-label)', color: 'var(--text-on-chrome)' }}
          >
            {name}
          </span>
          <span
            style={{
              display: 'block',
              font: 'var(--type-caption)',
              color: 'var(--text-on-chrome-secondary)',
            }}
          >
            {role}
          </span>
        </span>
        <Icon
          name="chevron-down"
          size={14}
          style={{
            color: 'var(--text-on-chrome-secondary)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--dur-fast) var(--ease-standard)',
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-2))',
            right: 0,
            minWidth: 240,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--elevation-overlay)',
            padding: 'var(--space-2)',
            zIndex: 50,
          }}
        >
          {/* Not a menuitem: it is the answer to "who am I signed in as", not
              an action, and making it focusable would put a dead stop in the
              keyboard path. */}
          <div
            style={{
              padding: 'var(--space-2)',
              borderBottom: '1px solid var(--border-default)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <div
              style={{
                font: 'var(--type-label)',
                color: 'var(--text-heading)',
                fontWeight: 'var(--weight-semibold)',
              }}
            >
              {name}
            </div>
            {email && (
              <div
                style={{
                  font: 'var(--type-caption)',
                  color: 'var(--text-secondary)',
                  overflowWrap: 'anywhere',
                }}
              >
                {email}
              </div>
            )}
            {role && (
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                {role}
              </div>
            )}
          </div>

          <MenuItem icon="user-round" label="Profile" onClick={choose(onProfile)} />
          <MenuItem icon="log-out" label="Sign out" onClick={choose(onSignOut)} tone="danger" />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: string
  label: string
  onClick: () => void
  tone?: 'danger'
}) {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        padding: 'var(--space-2)',
        background: hover ? 'var(--surface-sunken)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        font: 'var(--type-body-dense)',
        color: tone === 'danger' ? 'var(--kr-error)' : 'var(--text-body)',
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  )
}
