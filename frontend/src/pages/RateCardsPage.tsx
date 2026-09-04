import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Identifier } from '../components/core/Identifier'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { canManageBilling, nightWindowLabel } from '../lib/billing'
import { formatUgx } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { RateAmounts, RateCard, RateCardVersion } from '../types/billing'
import { RateCardVersionDialog } from './billing/RateCardVersionDialog'

/**
 * One priced row: a vehicle category's default price, or a zone price that
 * replaces it inside one boundary (ADR-0021).
 *
 * Both are flattened into the same table because they are the same five
 * amounts and a reader's question is "what is a sedan charged, and where" —
 * which a second table beside the first cannot answer at a glance.
 */
type RateRow = RateAmounts & { id: string; vehicle_category: string; zone: string | null }

const RATE_COLUMNS: DataColumn<RateRow>[] = [
  { key: 'vehicle_category', header: 'Category' },
  {
    key: 'zone',
    header: 'Zone',
    // "Anywhere else" rather than a dash: null here is a positive statement
    // — this is the price wherever no zone rate applies — and a dash would
    // read as missing data on a pricing document.
    render: (r) => (r.zone === null ? 'Anywhere else' : r.zone),
  },
  {
    key: 'base_fare_minor',
    header: 'Base fare',
    numeric: true,
    render: (r) => formatUgx(r.base_fare_minor),
  },
  {
    key: 'per_km_minor',
    header: 'Per km',
    numeric: true,
    render: (r) => formatUgx(r.per_km_minor),
  },
  {
    key: 'per_waiting_minute_minor',
    header: 'Per waiting min',
    numeric: true,
    render: (r) => formatUgx(r.per_waiting_minute_minor),
  },
  {
    key: 'minimum_charge_minor',
    header: 'Minimum',
    numeric: true,
    render: (r) => formatUgx(r.minimum_charge_minor),
  },
  {
    key: 'maximum_charge_minor',
    header: 'Maximum',
    numeric: true,
    // Null is uncapped, which is a different statement from "capped at 0".
    render: (r) =>
      r.maximum_charge_minor === null ? 'Uncapped' : formatUgx(r.maximum_charge_minor),
  },
]

export function RateCardsPage() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [cards, setCards] = useState<RateCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialogFor, setDialogFor] = useState<{
    card: RateCard | null
    /** ADR-0050 §5. A category to open the version with, blank. */
    addCategory?: string
  } | null>(null)

  const canManage = canManageBilling(user)

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<ApiSuccess<RateCard[]>>('/rate-cards')
      setCards(response.data.data)
      setError(null)
      setForbidden(false)
    } catch (failure) {
      const problem = apiError(failure, 'Could not load rate cards.')
      if (problem.code === 'FORBIDDEN') {
        setForbidden(true)
        setCards([])
        return
      }
      setError(problem.message)
    }
  }, [])

  // The initial fetch is written as a promise chain rather than `void
  // load()` so the state updates land in a callback: setState called
  // straight from an effect body cascades renders, which is what the
  // react-hooks/set-state-in-effect rule is about. Same shape as
  // ReportsPage.
  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<RateCard[]>>('/rate-cards')
      .then((response) => {
        if (!cancelled) setCards(response.data.data)
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        const problem = apiError(failure, 'Could not load rate cards.')
        if (problem.code === 'FORBIDDEN') {
          setForbidden(true)
          setCards([])
          return
        }
        setError(problem.message)
      })

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Opened from "Price it" on the vehicle categories screen (ADR-0050 §5).
   *
   * The categories screen can say a category is unpriced but cannot fix it —
   * a rate card version is immutable, so the price has to go on a *new*
   * version, and that is this dialog. Arriving here with the right card
   * already open and the missing category already added is the difference
   * between a warning and a way out.
   *
   * **Derived during render, not set from an effect.** Copying the router's
   * state into `useState` would be one source of truth mirrored into a
   * second, and it is the shape `react-hooks/set-state-in-effect` refuses:
   * a synchronous setState in an effect body cascades a render for a value
   * that was already available. It waits for `cards` only because the card
   * has to be found before the dialog can copy its latest version.
   *
   * The state is cleared when the dialog closes rather than when it opens,
   * so a browser Back into this entry does not reopen a dialog over a card
   * whose prices may since have changed.
   */
  const priceRequest = location.state as { priceCategory?: string; cardId?: number } | null

  const requested =
    priceRequest?.priceCategory !== undefined && cards !== null
      ? (cards.find((candidate) => candidate.id === priceRequest.cardId) ?? null)
      : null

  const openDialog =
    dialogFor ??
    (requested !== null ? { card: requested, addCategory: priceRequest?.priceCategory } : null)

  const closeDialog = () => {
    setDialogFor(null)

    if (priceRequest?.priceCategory !== undefined) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }

  const makeDefault = async (card: RateCard) => {
    try {
      await apiClient.put(`/rate-cards/${card.id}/default`)
      setNotice(`"${card.name}" is now the default rate card.`)
      await load()
    } catch (failure) {
      setError(apiError(failure, 'Could not change the default rate card.').message)
    }
  }

  if (forbidden) {
    return (
      <EmptyState
        icon="lock"
        title="Rate cards are not visible to your role"
        description="Restricted to Finance and administrators. Ask for access."
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Rate cards" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" title="Saved" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card
        title="Rate cards"
        subtitle="Prices are versioned. A version is never edited — changing a price adds another."
        actions={
          canManage ? (
            <Button iconLeft="plus" onClick={() => setDialogFor({ card: null })}>
              New rate card
            </Button>
          ) : undefined
        }
      >
        {cards === null && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}
        {cards !== null && cards.length === 0 && (
          <EmptyState
            icon="tags"
            title="No rate cards yet"
            description={
              canManage
                ? 'A trip cannot be invoiced until one card is marked as the default. Create one to get started.'
                : 'Nothing has been set up yet. Someone with Finance or Super Admin access needs to create one.'
            }
          />
        )}
      </Card>

      {(cards ?? []).map((card) => (
        <RateCardPanel
          /*
            **Keyed on the newest version, not just the card.**

            `RateCardPanel` picks which version to expand with a `useState`
            initialiser, which runs once per mounted instance. Keyed on
            `card.id` alone the instance survives every refetch, so adding a
            version left `expanded` pointing at the version that *used* to be
            newest: the list gained a row and the panel went on showing the old
            prices. Somebody had just changed a tariff and the screen appeared
            not to have noticed.

            Folding the newest version's id into the key remounts the panel
            exactly when the answer to "which version is current" changes, and
            leaves it alone on every other reload. An effect syncing the state
            would do the same thing and trip `react-hooks/set-state-in-effect`,
            which this codebase already documents as a rule it keeps.
          */
          key={`${card.id}:${card.versions?.[0]?.id ?? 'none'}`}
          card={card}
          canManage={canManage}
          onEdit={() => setDialogFor({ card })}
          onMakeDefault={() => void makeDefault(card)}
        />
      ))}

      {openDialog && (
        <RateCardVersionDialog
          card={openDialog.card}
          addCategory={openDialog.addCategory}
          onClose={closeDialog}
          onSaved={(message) => {
            closeDialog()
            setNotice(message)
            void load()
          }}
        />
      )}
    </div>
  )
}

function RateCardPanel({
  card,
  canManage,
  onEdit,
  onMakeDefault,
}: {
  card: RateCard
  canManage: boolean
  onEdit: () => void
  onMakeDefault: () => void
}) {
  // Versions arrive newest first. The top one is what a trip run today
  // would price at, so it is the one opened by default.
  const [expanded, setExpanded] = useState<number | null>(card.versions?.[0]?.id ?? null)

  return (
    <Card
      title={card.name}
      subtitle={card.description ?? undefined}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-inline)' }}>
          {card.is_default ? (
            <Badge tone="brand" icon="star">
              Default
            </Badge>
          ) : (
            canManage && (
              <Button size="sm" variant="secondary" iconLeft="star" onClick={onMakeDefault}>
                Make default
              </Button>
            )
          )}
          {/*
            **One Edit, opening the same form the card was created with.**

            There were two buttons here — *Edit* for the name and *New version*
            for the prices — and the owner put the two dialogs side by side and
            said the edit was a different thing from the create. It was: the
            immutability rule had been made the *shape of the UI* rather than
            the behaviour of Save.

            It is the behaviour of Save now. The form carries everything;
            renaming issues a PATCH, repricing adds a version, and doing both
            does both. The rule is unchanged and the dialog states it — what
            went away is having to know which button implements which half.
          */}
          {canManage && (
            <Button size="sm" iconLeft="pencil" onClick={onEdit}>
              Edit
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {(card.versions ?? []).map((version) => (
          <VersionBlock
            key={version.id}
            version={version}
            open={expanded === version.id}
            onToggle={() => setExpanded((current) => (current === version.id ? null : version.id))}
          />
        ))}
        {(card.versions ?? []).length === 0 && (
          <p style={{ color: 'var(--text-secondary)' }}>
            This card has no versions and cannot price a trip.
          </p>
        )}
      </div>
    </Card>
  )
}

function VersionBlock({
  version,
  open,
  onToggle,
}: {
  version: RateCardVersion
  open: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          width: '100%',
          padding: 'var(--space-3) var(--space-4)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Identifier size="sm">v{version.version}</Identifier>
        <span style={{ font: 'var(--type-body-dense)', color: 'var(--text-body)' }}>
          from {version.effective_from ?? '—'}
        </span>
        {/* A locked version has priced a real invoice and can never change.
            That is the single most useful fact about it, so it leads. */}
        {version.is_locked ? (
          <Badge tone="neutral" size="sm" icon="lock">
            In use — sealed
          </Badge>
        ) : (
          <Badge tone="info" size="sm" icon="lock-open">
            Not yet used
          </Badge>
        )}
        <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          {version.rounding_mode_label} · {version.free_waiting_minutes} free waiting min ·{' '}
          {nightWindowLabel(version)}
        </span>
      </button>

      {open && (
        <DataTable<RateRow>
          columns={RATE_COLUMNS}
          rows={(version.rates ?? []).flatMap((rate) => [
            {
              ...rate,
              id: `${version.id}-${rate.vehicle_category}`,
              zone: null,
            },
            // Each zone price directly under the default it overrides, so
            // the two are read together rather than looked up separately.
            ...(rate.zone_rates ?? []).map((zoneRate) => ({
              ...zoneRate,
              id: `${version.id}-${rate.vehicle_category}-${zoneRate.zone_id}`,
              vehicle_category: rate.vehicle_category,
              zone: zoneRate.zone_name,
            })),
          ])}
          dense
          emptyMessage="This version prices no vehicle category"
        />
      )}
    </div>
  )
}
