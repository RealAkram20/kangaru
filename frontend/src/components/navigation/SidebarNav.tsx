import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../core/Icon'
import { Logo } from '../brand/Logo'

export interface SidebarItem {
  id: string
  label: string
  /** Lucide icon name — every nav item has one. */
  icon: string
  /** Count chip, e.g. unassigned bookings. */
  badge?: number | string
}

export interface SidebarSection {
  /** Uppercase overline group label, e.g. "OPERATIONS". Omit for the first ungrouped block. */
  label?: string
  items: SidebarItem[]
}

export interface SidebarNavProps extends HTMLAttributes<HTMLElement> {
  sections?: SidebarSection[]
  /** id of the active item. */
  active?: string
  onNavigate?: (id: string) => void
  /** Icon-only 64px rail. */
  collapsed?: boolean
  /** Path from the page to the assets folder (for the logo). */
  basePath?: string
  /** Bottom slot — usually the signed-in user row. */
  footer?: ReactNode
}

export function SidebarNav({
  sections = [],
  active,
  onNavigate,
  collapsed = false,
  basePath = '/assets',
  footer,
  style,
  ...rest
}: SidebarNavProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <nav
      style={{
        width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)',
        flex: '0 0 auto',
        background: 'var(--surface-chrome)',
        borderRight: '1px solid var(--border-chrome)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width var(--dur-base) var(--ease-standard)',
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          height: 'var(--topbar-h)',
          display: 'flex',
          alignItems: 'center',
          padding: collapsed ? 0 : '0 var(--space-4)',
          justifyContent: collapsed ? 'center' : 'flex-start',
          flex: '0 0 auto',
        }}
      >
        {collapsed ? (
          <Logo variant="mark-solid" height={28} basePath={basePath} />
        ) : (
          <Logo variant="horizontal-navy" height={30} basePath={basePath} />
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2) var(--space-2) var(--space-6)' }}>
        {sections.map((section, si) => (
          <div key={section.label || si} style={{ marginTop: si ? 'var(--space-6)' : 'var(--space-2)' }}>
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
              {(section.items || []).map((item) => {
                const on = item.id === active
                const hot = hovered === item.id && !on
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate?.(item.id)}
                    onMouseEnter={() => setHovered(item.id)}
                    onMouseLeave={() => setHovered(null)}
                    title={collapsed ? item.label : undefined}
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
                    <Icon name={item.icon} size={18} style={{ color: on ? 'var(--action-primary)' : 'currentColor' }} />
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
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {footer && (
        <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--border-chrome)', padding: 'var(--space-3)' }}>
          {footer}
        </div>
      )}
    </nav>
  )
}
