import { useState } from 'react'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Textarea } from '../../components/forms/Textarea'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { HeldTrip, Trip } from '../../types/trip'
import { DistanceEvidencePanel } from './DistanceEvidencePanel'

/**
 * Clearing a held distance (ADR-0045 §2).
 *
 * **The evidence is in the dialog, above the reason box.** A clearance
 * overrules the resolver, and a reviewer who has to leave this screen to see
 * what they are overruling will stop looking. It is also why the reason is
 * required and has a floor: this is an audited override of the platform's own
 * measurement, and "ok" is not a sentence a bank's auditor accepts.
 *
 * It does not change the figure. The trip bills on `billed_distance_km` as
 * the resolver left it — the hold is lifted, not the arithmetic rewritten.
 */
export function ClearDistanceDialog({
  trip,
  onClose,
  onCleared,
}: {
  trip: HeldTrip
  onClose: () => void
  onCleared: (tripId: number) => void
}) {
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The server's own floor (`ClearTripDistanceRequest`), mirrored so the
  // button is honest about being unusable rather than answering 422.
  const tooShort = reason.trim().length < 10

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setFailure(null)

    try {
      await apiClient.post<ApiSuccess<Trip>>(`/trips/${trip.trip_id}/distance/clearance`, {
        reason: reason.trim(),
      })

      onCleared(trip.trip_id)
    } catch (error) {
      const problem = apiError(error, 'Could not clear this trip.')

      setErrors(fieldErrors(problem))
      setFailure(problem.message)
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      title={`Clear the distance on trip #${trip.trip_id}`}
      description={`${trip.origin} → ${trip.destination}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={submitting || tooShort}
            onClick={() => void submit()}
          >
            Clear and allow billing
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {failure !== null && (
          <Alert tone="error" title="Could not clear" onDismiss={() => setFailure(null)}>
            {failure}
          </Alert>
        )}

        <DistanceEvidencePanel tripId={trip.trip_id} />

        <FormField
          label="Why is this being cleared?"
          htmlFor="clear-reason"
          hint={
            trip.is_walk_in
              ? 'Recorded against the trip and audited. Clearing settles the driver’s fare on the figure above.'
              : 'Recorded against the trip and audited. Clearing lets this trip be invoiced on the figure above.'
          }
          error={errors.reason}
          required
        >
          <Textarea
            id="clear-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="What you checked, and what convinced you."
          />
        </FormField>
      </div>
    </Dialog>
  )
}
