import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../core/Icon'
import { IconButton } from '../core/IconButton'
import { Logo } from '../brand/Logo'

export interface SidebarItem {
  id: string
  label: string
  /** Lucide icon name — every nav item has one. */
  icon: string
  /** Count chip, e.g. unassigned bookings. */
  badge?: number | string
  /**
   * Renders the row as a switch with a track on the right (dark mode). The row
   * itself is the control, so there is no nested button to trap the keyboard.
   */
  checked?: boolean
}

export interface SidebarSection {
  /** Uppercase overline group label, e.g. "OPERATIONS". Omit for the first ungrouped block. */
  label?: string
  items: SidebarItem[]
}

export interface SidebarUser {
  name: string
  /** One of the ten platform roles, e.g. "Dispatcher", "Finance". */
  role?: string
  initials?: string
  avatarUrl?: string
}

export interface SidebarNavProps extends HTMLAttributes<HTMLElement> {
  sections?: SidebarSection[]
  /** id of the active item. */
  active?: string
  onNavigate?: (id: string) => void
  /** Identity card pinned under the logo. */
  user?: SidebarUser
  /**
   * Supply to make the identity card open the signed-in user's own profile.
   *
   * Optional rather than always-on: the design-system previews render this
   * sidebar with no router behind it, and a widget that looks pressable and
   * goes nowhere is the exact defect this fixes. When it is omitted the card
   * stays the plain `<div>` it has always been.
   */
  onUserClick?: () => void
  /** Pinned to the bottom above the footer — logout, dark mode. Same rows, same handler. */
  bottomItems?: SidebarItem[]
  /** Icon-only 64px rail. */
  collapsed?: boolean
  /** Render off-canvas over the page instead of in flow — for narrow viewports. */
  mobile?: boolean
  /** Off-canvas only: whether the drawer is slid in. */
  open?: boolean
  /** Off-canvas only: dismiss via the scrim or the header's close button. */
  onClose?: () => void
  /** Path from the page to the assets folder (for the logo). */
  basePath?: string
  /** Bottom slot below `bottomItems`. */
  footer?: ReactNode
}

const DIVIDER: CSSProperties = {
  height: 1,
  background: 'var(--border-chrome)',
  margin: '0 var(--space-4)',
  flex: '0 0 auto',
}

function initialsOf(user: SidebarUser): string {
  return user.initials || (user.name || '?').slice(0, 2).toUpperCase()
}

export function SidebarNav({
  sections = [],
  active,
  onNavigate,
  user,
  onUserClick,
  bottomItems = [],
  collapsed = false,
  mobile = false,
  open = false,
  onClose,
  basePath = '/assets',
  footer,
  style,
  ...rest
}: SidebarNavProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  const renderItem = (item: SidebarItem) => {
    const on = item.id === active
    const hot = hovered === item.id && !on
    const isSwitch = item.checked !== undefined
    return (
      <button
        key={item.id}
        onClick={() => onNavigate?.(item.id)}
        onMouseEnter={() => setHovered(item.id)}
        onMouseLeave={() => setHovered(null)}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        aria-current={on ? 'page' : undefined}
        role={isSwitch ? 'switch' : undefined}
        aria-checked={isSwitch ? item.checked : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          width: '100%',
          padding: collapsed ? '10px 0' : '9px var(--space-3)',
          justifyContent: collapsed ? 'center' : 'flex-start',
          border: 'none',
          borderRadius: 'var(--radius-control)',
          background: on
            ? 'var(--surface-chrome-elevated)'
            : hot
              ? 'var(--action-ghost-hover-bg-chrome)'
              : 'transparent',
          color: on ? 'var(--text-on-chrome)' : 'var(--text-on-chrome-secondary)',
          font: 'var(--type-label)',
          fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)',
          cursor: 'pointer',
          position: 'relative',
          textAlign: 'left',
          transition: 'var(--transition-control)',
        }}
      >
        {on && (
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: '0 2px 2px 0',
              background: 'var(--action-primary)',
            }}
          />
        )}
        <Icon
          name={item.icon}
          size={18}
          style={{ color: on ? 'var(--action-primary)' : 'currentColor' }}
        />
        {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
        {!collapsed && item.badge !== undefined && (
          <span
            style={{
              font: 'var(--type-caption)',
              fontWeight: 'var(--weight-semibold)',
              background: 'var(--action-primary)',
              color: 'var(--text-on-brand)',
              borderRadius: 'var(--radius-pill)',
              padding: '1px 6px',
            }}
          >
            {item.badge}
          </span>
        )}
        {!collapsed && isSwitch && (
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 20,
              flex: '0 0 auto',
              padding: 2,
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 'var(--radius-pill)',
              background: item.checked ? 'var(--action-primary)' : 'var(--surface-chrome-elevated)',
              transition: 'var(--transition-control)',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 'var(--radius-pill)',
                background: 'var(--kr-white)',
                transform: item.checked ? 'translateX(14px)' : 'translateX(0)',
                transition: 'transform var(--dur-fast) var(--ease-standard)',
              }}
            />
          </span>
        )}
      </button>
    )
  }

  // Off-canvas it floats over the page at full width; in flow it just changes width.
  const shellStyle: CSSProperties = mobile
    ? {
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: 0,
        width: 'var(--sidebar-w)',
        zIndex: 50,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        // Hidden keeps the closed drawer out of the tab order.
        visibility: open ? 'visible' : 'hidden',
        boxShadow: open ? 'var(--shadow-modal)' : 'none',
        transition:
          'transform var(--dur-base) var(--ease-standard),visibility var(--dur-base) var(--ease-standard)',
      }
    : {
        width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)',
        transition: 'width var(--dur-base) var(--ease-standard)',
      }

  return (
    <>
      {mobile && (
        <div
          role="presentation"
          onClick={onClose}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            background: 'var(--overlay-scrim)',
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'auto' : 'none',
            transition: 'opacity var(--dur-base) var(--ease-standard)',
          }}
        />
      )}
      <nav
        aria-label="Primary"
        aria-hidden={mobile && !open ? true : undefined}
        style={{
          flex: '0 0 auto',
          background: 'var(--surface-chrome)',
          borderRight: '1px solid var(--border-chrome)',
          display: 'flex',
          flexDirection: 'column',
          ...shellStyle,
          ...style,
        }}
        {...rest}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: collapsed
              ? 'var(--space-4) var(--space-3)'
              : 'var(--space-5) var(--space-4) var(--space-4)',
            justifyContent: collapsed ? 'center' : 'flex-start',
            flex: '0 0 auto',
          }}
        >
          {collapsed ? (
            <Logo variant="mark-solid" height={36} basePath={basePath} />
          ) : (
            // Full-bleed lockup: width drives the size and the 3.57:1 artwork sets the height,
            // so `style` deliberately overrides the component's height-first sizing.
            <Logo
              variant="horizontal-navy"
              basePath={basePath}
              style={{ flex: 1, minWidth: 0, width: '100%', height: 'auto' }}
            />
          )}
          {mobile && onClose && (
            <IconButton
              icon="x"
              label="Close navigation"
              size="sm"
              onChrome
              onClick={onClose}
              style={{ marginLeft: 'auto' }}
            />
          )}
        </div>

        {user &&
          (() => {
            // A `<button>` only when there is somewhere to go, so the
            // preview harness keeps the inert card it has always had.
            const Identity = onUserClick ? 'button' : 'div'
            const on = active === 'profile'
            const hot = hovered === 'sidebar-user' && !on

            return (
              <>
                <div style={DIVIDER} />
                <Identity
                  {...(onUserClick
                    ? {
                        type: 'button' as const,
                        onClick: onUserClick,
                        onMouseEnter: () => setHovered('sidebar-user'),
                        onMouseLeave: () => setHovered(null),
                        'aria-current': on ? ('page' as const) : undefined,
                        'aria-label': `${user.name} — your profile`,
                      }
                    : {})}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    width: onUserClick ? '100%' : undefined,
                    padding: collapsed ? 'var(--space-3) 0' : 'var(--space-3) var(--space-4)',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    flex: '0 0 auto',
                    border: 'none',
                    background: on
                      ? 'var(--surface-chrome-elevated)'
                      : hot
                        ? 'var(--action-ghost-hover-bg-chrome)'
                        : 'transparent',
                    font: 'inherit',
                    color: 'inherit',
                    textAlign: 'left',
                    cursor: onUserClick ? 'pointer' : undefined,
                    transition: 'var(--transition-control)',
                  }}
                  title={
                    collapsed ? `${user.name}${user.role ? ` — ${user.role}` : ''}` : undefined
                  }
                >
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      style={{
                        width: 36,
                        height: 36,
                        flex: '0 0 auto',
                        borderRadius: 'var(--radius-pill)',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 36,
                        height: 36,
                        flex: '0 0 auto',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--action-primary)',
                        color: 'var(--text-on-brand)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        font: 'var(--type-label)',
                        fontWeight: 'var(--weight-semibold)',
                      }}
                    >
                      {initialsOf(user)}
                    </span>
                  )}
                  {!collapsed && (
                    <span style={{ minWidth: 0, lineHeight: 1.25 }}>
                      <span
                        style={{
                          display: 'block',
                          font: 'var(--type-label)',
                          fontWeight: 'var(--weight-semibold)',
                          color: 'var(--text-on-chrome)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {user.name}
                      </span>
                      {user.role && (
                        <span
                          style={{
                            display: 'block',
                            font: 'var(--type-caption)',
                            color: 'var(--text-on-chrome-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {user.role}
                        </span>
                      )}
                    </span>
                  )}
                  {/* The card reads as identity, not as a control, without
                  something pointing off it. One chevron is enough. */}
                  {onUserClick && !collapsed && (
                    <Icon
                      name="chevron-right"
                      size={16}
                      style={{ marginLeft: 'auto', color: 'var(--text-on-chrome-secondary)' }}
                    />
                  )}
                </Identity>
                <div style={DIVIDER} />
              </>
            )
          })()}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 'var(--space-2) var(--space-2) var(--space-6)',
          }}
        >
          {sections.map((section, si) => (
            <div
              key={section.label || si}
              style={{ marginTop: si ? 'var(--space-6)' : 'var(--space-2)' }}
            >
              {section.label && !collapsed && (
                <p
                  style={{
                    font: 'var(--type-overline)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-caps)',
                    color: 'var(--text-on-chrome-secondary)',
                    padding: '0 var(--space-3) var(--space-2)',
                  }}
                >
                  {section.label}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(section.items || []).map(renderItem)}
              </div>
            </div>
          ))}
        </div>

        {bottomItems.length > 0 && (
          <>
            <div style={DIVIDER} />
            <div
              style={{
                flex: '0 0 auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: 'var(--space-2)',
              }}
            >
              {bottomItems.map(renderItem)}
            </div>
          </>
        )}

        {footer && (
          <div
            style={{
              flex: '0 0 auto',
              borderTop: '1px solid var(--border-chrome)',
              padding: 'var(--space-3)',
            }}
          >
            {footer}
          </div>
        )}
      </nav>
    </>
  )
}
