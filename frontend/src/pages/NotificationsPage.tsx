import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Icon } from '../components/core/Icon'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { formatRelativeTime, formatTimestamp } from '../lib/format'
import { notificationIcon, notificationTone, useNotifications } from '../lib/notifications'
import type { AppNotification } from '../types/notification'

/**
 * The full inbox.
 *
 * The bell shows the last eight and is for interrupting; this is for going
 * back through them. Both read the same `useNotifications` hook, so "mark
 * read" cannot mean two different things depending on where it was clicked.
 *
 * Not polled. Someone reading their history is not waiting for something to
 * arrive, and a list that reorders under a reader is worse than a stale one.
 */
export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { items, unread, error, markRead, markAllRead, reload, dismissError } = useNotifications({
    limit: 100,
    unreadOnly,
  })
  const navigate = useNavigate()

  const open = (item: AppNotification) => {
    if (!item.is_read) void markRead(item.id)
    if (item.url) navigate(item.url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Notifications unavailable" onDismiss={dismissError}>
          {error}
        </Alert>
      )}

      <Card
        title="Notifications"
        subtitle={
          items === null
            ? undefined
            : unread === 0
              ? 'Everything read'
              : `${unread} unread`
        }
        padding="none"
        actions={
          <div style={{ display: 'flex', gap: 'var(--gap-inline)' }}>
            <Button
              size="sm"
              variant={unreadOnly ? 'primary' : 'secondary'}
              iconLeft="filter"
              // aria-pressed, not just a colour change: a toggle whose only
              // state cue is its fill is invisible to a screen reader.
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly((on) => !on)}
            >
              Unread only
            </Button>
            <Button size="sm" variant="secondary" iconLeft="refresh-cw" onClick={() => void reload()}>
              Refresh
            </Button>
            <Button
              size="sm"
              variant="secondary"
              iconLeft="check-check"
              disabled={unread === 0}
              onClick={() => void markAllRead()}
            >
              Mark all read
            </Button>
          </div>
        }
      >
        {items === null ? (
          <p style={{ padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon="bell-off"
            title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
            description={
              unreadOnly
                ? 'Everything addressed to you has been read.'
                : 'When a booking of yours is approved or refused, or an export you asked for finishes, it will appear here.'
            }
          />
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              style={{
                display: 'flex',
                gap: 'var(--space-4)',
                padding: 'var(--space-4)',
                borderBottom: '1px solid var(--border-default)',
                background: item.is_read ? 'transparent' : 'var(--surface-accent)',
              }}
            >
              <Icon
                name={notificationIcon(item.type)}
                size={18}
                style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: 2 }}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    marginBottom: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      font: 'var(--type-label)',
                      fontWeight: item.is_read ? 400 : 600,
                      color: 'var(--text-body)',
                    }}
                  >
                    {item.subject}
                  </span>
                  <Badge tone={notificationTone(item.type)} size="sm">
                    {item.type_label}
                  </Badge>
                  {!item.is_read && (
                    <Badge tone="info" size="sm" icon="dot">
                      Unread
                    </Badge>
                  )}
                </div>

                {/*
                  The body is the server's frozen sentence, shown as-is. It
                  records what this person was told, so re-rendering it from
                  `context` would risk telling them something else later.
                */}
                <p style={{ font: 'var(--type-body)', color: 'var(--text-body)', margin: '0 0 6px' }}>
                  {item.body}
                </p>

                <span
                  style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}
                  title={formatTimestamp(item.created_at)}
                >
                  {formatRelativeTime(item.created_at)}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--gap-inline)', alignItems: 'flex-start' }}>
                {item.url && (
                  <Button size="sm" variant="secondary" iconLeft="arrow-right" onClick={() => open(item)}>
                    Open
                  </Button>
                )}
                {!item.is_read && (
                  <Button size="sm" variant="ghost" onClick={() => void markRead(item.id)}>
                    Mark read
                  </Button>
                )}
              </div>
            </article>
          ))
        )}
      </Card>
    </div>
  )
}
