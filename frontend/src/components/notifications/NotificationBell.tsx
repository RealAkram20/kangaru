import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../core/Icon'
import { IconButton } from '../core/IconButton'
import { EmptyState } from '../feedback/EmptyState'
import { formatRelativeTime } from '../../lib/format'
import { notificationIcon, notificationTone, useNotifications } from '../../lib/notifications'
import type { AppNotification } from '../../types/notification'

/**
 * The unread badge and its panel.
 *
 * Self-contained and drop-in: it takes no props, fetches its own data, and
 * renders a single button. Mounting it is one line in whatever chrome ends
 * up owning it —
 *
 *     <NotificationBell />
 *
 * — which is deliberate. `Topbar.tsx` is uncommitted work in progress at
 * the time of writing, so this is built to be added there without this
 * component needing to change.
 *
 * It polls, because nothing is pushed yet: PROJECT.md's stack names Laravel
 * Reverb and no broadcasting exists (Modules/Notifications/README.md,
 * deferred item 9). Polling is the honest interim, and the interval is long
 * enough not to be a load problem.
 */

/** 60s: an in-app notification is not a chat message. */
const POLL_MS = 60_000

const TONE_COLOUR: Record<string, string> = {
  success: 'var(--kr-success)',
  warning: 'var(--kr-warning)',
  info: 'var(--kr-info)',
  neutral: 'var(--text-secondary)',
}

export function NotificationBell({ onChrome = true }: { onChrome?: boolean }) {
  const [open, setOpen] = useState(false)
  const { items, unread, markRead, markAllRead } = useNotifications({ limit: 8, pollMs: POLL_MS })
  const navigate = useNavigate()
  const wrapper = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape. A panel that can only be closed by
  // the button that opened it traps a user who clicked elsewhere expecting
  // it to go away.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const openItem = (item: AppNotification) => {
    if (!item.is_read) void markRead(item.id)
    setOpen(false)
    if (item.url) navigate(item.url)
  }

  return (
    <div ref={wrapper} style={{ position: 'relative' }}>
      <IconButton
        icon="bell"
        // The count is in the label, not only in the badge: a screen reader
        // user gets "Notifications, 3 unread" rather than "Notifications"
        // and a number they cannot reach.
        label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
        onChrome={onChrome}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      />

      {unread > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: 'var(--kr-error)',
            color: '#fff',
            font: 'var(--type-caption)',
            fontWeight: 600,
            lineHeight: '16px',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 380,
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))',
            zIndex: 60,
            overflow: 'hidden',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid var(--border-default)',
            }}
          >
            <span style={{ font: 'var(--type-label)', color: 'var(--text-body)' }}>Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => void markAllRead()}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  font: 'var(--type-caption)',
                  color: 'var(--action-primary)',
                }}
              >
                Mark all read
              </button>
            )}
          </header>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {items === null ? (
              <p style={{ padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>Loading…</p>
            ) : items.length === 0 ? (
              <EmptyState
                compact
                icon="bell-off"
                title="Nothing yet"
                description="Approvals, refusals and finished exports will appear here."
              />
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openItem(item)}
                  style={{
                    display: 'flex',
                    gap: 'var(--space-3)',
                    width: '100%',
                    textAlign: 'left',
                    padding: 'var(--space-3) var(--space-4)',
                    // Unread is carried by weight and a dot as well as the
                    // tint — status is never colour-only.
                    background: item.is_read ? 'transparent' : 'var(--surface-accent)',
                    border: 'none',
                    borderBottom: '1px solid var(--border-default)',
                    cursor: 'pointer',
                  }}
                >
                  <Icon
                    name={notificationIcon(item.type)}
                    size={16}
                    style={{ color: TONE_COLOUR[notificationTone(item.type)], flexShrink: 0, marginTop: 2 }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        font: 'var(--type-label)',
                        fontWeight: item.is_read ? 400 : 600,
                        color: 'var(--text-body)',
                      }}
                    >
                      {item.subject}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        font: 'var(--type-caption)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {formatRelativeTime(item.created_at)}
                    </span>
                  </span>
                  {!item.is_read && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: 'var(--action-primary)',
                        flexShrink: 0,
                        marginTop: 6,
                      }}
                    />
                  )}
                </button>
              ))
            )}
          </div>

          <footer style={{ padding: 'var(--space-2) var(--space-4)', textAlign: 'center' }}>
            <button
              onClick={() => {
                setOpen(false)
                navigate('/notifications')
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 'var(--space-2)',
                cursor: 'pointer',
                font: 'var(--type-caption)',
                color: 'var(--action-primary)',
              }}
            >
              See all notifications
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
