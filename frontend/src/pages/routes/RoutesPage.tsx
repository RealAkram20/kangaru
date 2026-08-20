import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Icon } from '../../components/core/Icon'
import { Identifier } from '../../components/core/Identifier'
import { Alert } from '../../components/feedback/Alert'
import { EmptyState } from '../../components/feedback/EmptyState'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import { stopCountLabel, type ClientRoute } from './routeBuilder'

/**
 * The client's routes (ADR-0045 §1).
 *
 * A list rather than a table: a route has three facts worth a column and a
 * table of three columns is a list wearing borders. What the officer is
 * doing here is *choosing one to open*, and the name plus the stop count is
 * what they choose on.
 *
 * **No distance on these cards, and that is not an omission.** Drawing every
 * route's line to state one would be a routing request per row on every
 * page load, billed, to render a number nobody is here to read. It appears
 * in the builder, once, for the route being worked on.
 */
export function RoutesPage() {
  const navigate = useNavigate()
  const [routes, setRoutes] = useState<ClientRoute[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void apiClient
      .get<ApiSuccess<ClientRoute[]>>('/routes')
      .then((response) => {
        if (!cancelled) setRoutes(response.data.data)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(apiError(failure, 'Your routes could not be loaded.').message)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {error !== null && <Alert tone="error">{error}</Alert>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button iconLeft="plus" onClick={() => navigate('/routes/new')}>
          New route
        </Button>
      </div>

      {routes !== null && routes.length === 0 && (
        <EmptyState
          icon="route"
          title="No routes yet"
          description="A route is a circuit your team drives — head office, then each site in the order they are served. Build one once and raise a booking from it whenever the run is needed."
          action={
            <Button iconLeft="plus" onClick={() => navigate('/routes/new')}>
              Build your first route
            </Button>
          }
        />
      )}

      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {(routes ?? []).map((route) => (
          <Card key={route.id} padding="sm">
            <button
              type="button"
              onClick={() => navigate(`/routes/${route.id}`)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                background: 'transparent',
                border: 0,
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon name="route" size={20} style={{ color: 'var(--text-secondary)' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: 'var(--type-section-title)' }}>
                  {route.name}
                </span>
                <span
                  style={{ display: 'block', font: 'var(--type-caption)', color: 'var(--text-secondary)' }}
                >
                  {stopCountLabel(route.stop_count ?? route.stops?.length ?? 0)}
                  {route.members !== undefined && route.members.length > 0 && (
                    <> · {route.members.length === 1 ? '1 person' : `${route.members.length} people`}</>
                  )}
                </span>
              </span>
              {route.reference !== null && <Identifier>{route.reference}</Identifier>}
              {/* Not colour alone: the word carries it (DESIGN.md §8). */}
              {!route.is_active && <Badge tone="neutral">Retired</Badge>}
              <Icon name="chevron-right" size={16} style={{ color: 'var(--text-placeholder)' }} />
            </button>
          </Card>
        ))}
      </div>
    </div>
  )
}
