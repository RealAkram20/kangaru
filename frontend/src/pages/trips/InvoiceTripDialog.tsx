import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Select } from '../../components/forms/Select'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { newIdempotencyKey } from '../../lib/billing'
import { formatDistance, formatDuration } from '../../lib/tripStatus'
import type { ApiSuccess } from '../../types/api'
import type { Invoice, RateCard } from '../../types/billing'
import type { Trip } from '../../types/trip'

/**
 * Raises the invoice for a completed trip.
 *
 * The trip's move to Invoice Generated happens inside the same backend
 * transaction that writes the invoice, so there is nothing to do here
 * afterwards but re-read the trip — which is also why this dialog exists
 * instead of a plain "Invoice generated" transition button. Asking the
 * transitions endpoint for that state is refused with a 422 by design: a
 * trip marked billed with no invoice behind it can never be billed
 * afterwards.
 */
export function InvoiceTripDialog({
  trip,
  onClose,
  onIssued,
}: {
  trip: Trip
  onClose: () => void
  onIssued: (invoice: Invoice) => void
}) {
  const [cards, setCards] = useState<RateCard[] | null>(null)
  const [rateCardId, setRateCardId] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [failureCode, setFailureCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // One key for this dialog, reused on retry. A new key per click would
  // turn a retry after a dropped response into a second billing attempt —
  // which the server refuses, but for the wrong reason.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [])

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<RateCard[]>>('/rate-cards')
      .then((response) => {
        if (!cancelled) setCards(response.data.data.filter((card) => card.status === 'active'))
      })
      // Not fatal: leaving the card unnamed bills against the tenant's
      // default, which is the normal path anyway.
      .catch(() => {
        if (!cancelled) setCards([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  const defaultCard = (cards ?? []).find((card) => card.is_default) ?? null

  const submit = async () => {
    setSubmitting(true)
    setFailure(null)
    setFailureCode(null)

    try {
      const response = await apiClient.post<ApiSuccess<Invoice>>(
        `/trips/${trip.id}/invoice`,
        rateCardId === '' ? {} : { rate_card_id: Number(rateCardId) },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      )

      onIssued(response.data.data)
    } catch (error) {
      const problem = apiError(error, 'Could not invoice this trip.')
      setFailure(problem.message)
      setFailureCode(problem.code)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      title={`Invoice trip #${trip.id}`}
      description={`${trip.origin} → ${trip.destination}, ${trip.vehicle?.registration_number ?? 'no vehicle'}.`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Back
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            Generate invoice
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {failure && (
          <Alert tone={failureCode === 'RATE_CARD_NOT_CONFIGURED' ? 'warning' : 'error'} title="Not invoiced">
            {failure}
          </Alert>
        )}

        <Alert tone="info" title="An issued invoice is final">
          It cannot be edited or deleted. If the amount turns out to be wrong, the correction is a credit
          note against it.
        </Alert>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' }}>
          <Fact label="Distance" value={formatDistance(trip.distance_km)} />
          <Fact label="Duration" value={formatDuration(trip.duration_minutes)} />
          <Fact label="Vehicle category" value={trip.vehicle?.category ?? '—'} />
        </div>

        <FormField
          label="Rate card"
          htmlFor="inv-card"
          hint={
            defaultCard
              ? `Leave as the default to bill against "${defaultCard.name}".`
              : 'No default rate card is set. Set one on the Rate cards page, or name a card here.'
          }
        >
          <Select
            id="inv-card"
            placeholder={defaultCard ? `Default — ${defaultCard.name}` : 'Default rate card'}
            value={rateCardId}
            onChange={(e) => setRateCardId(e.target.value)}
            disabled={cards === null}
            options={(cards ?? []).map((card) => ({
              value: String(card.id),
              label: card.is_default ? `${card.name} (default)` : card.name,
            }))}
          />
        </FormField>

        <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          The amount is computed from the rate card version in force on{' '}
          {trip.started_at ? trip.started_at.slice(0, 10) : 'the trip date'} — not today's prices — and from
          the waiting time on this trip's timeline.
        </p>
      </div>
    </Dialog>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</p>
      <p style={{ font: 'var(--type-body)', color: 'var(--text-heading)', marginTop: 2 }}>{value}</p>
    </div>
  )
}
