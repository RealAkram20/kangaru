import { useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { isDestructiveTransition, tripStatusLabel, transitionNeeds } from '../../lib/tripStatus'
import type { ApiSuccess } from '../../types/api'
import type { Trip, TripStatus } from '../../types/trip'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { OdometerPhotoField } from './OdometerPhotoField'

/**
 * Laravel reads a multipart body through its own parser, so scalars have to
 * be strings — a number appended to FormData arrives as one anyway, and
 * being explicit keeps that from looking like an accident.
 */
function buildFormData(fields: Record<string, string | number>, photo: File): FormData {
  const form = new FormData()

  for (const [key, value] of Object.entries(fields)) {
    form.append(key, String(value))
  }

  form.append('odometer_photo', photo)

  return form
}

/**
 * Collects whatever a given transition needs and posts it.
 *
 * Deliberately one dialog for every transition rather than a bespoke
 * screen each: the backend has one endpoint and one request class
 * (TransitionTripRequest), and mirroring that keeps the set of things that
 * can drift down to one.
 */
export function TransitionDialog({
  trip,
  to,
  onClose,
  onDone,
}: {
  trip: Trip
  to: TripStatus
  onClose: () => void
  onDone: (trip: Trip) => void
}) {
  const needs = transitionNeeds(to)
  const [odometer, setOdometer] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const destructive = isDestructiveTransition(to)

  // The opening reading is the floor for the closing one. Checked here only
  // to catch the typo before a round trip; TransitionTripRequest enforces it.
  const reading = Number(odometer)
  const belowOpening =
    needs.odometer === 'end' &&
    trip.odometer_start !== null &&
    odometer !== '' &&
    reading < trip.odometer_start

  const incomplete =
    (needs.odometer !== null && odometer.trim() === '') || (needs.reason && notes.trim() === '')

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setFailure(null)

    try {
      const fields: Record<string, string | number> = {
        to,
        ...(needs.odometer === 'start' ? { odometer_start: reading } : {}),
        ...(needs.odometer === 'end' ? { odometer_end: reading } : {}),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      }

      // JSON unless there is a photo. Sending multipart unconditionally
      // would turn every transition into a form-encoded request for the
      // sake of the two that can carry a file, and `notes` would arrive as
      // the string "undefined" rather than being absent.
      const response = photo
        ? await apiClient.post<ApiSuccess<Trip>>(
            `/trips/${trip.id}/transitions`,
            buildFormData(fields, photo),
          )
        : await apiClient.post<ApiSuccess<Trip>>(`/trips/${trip.id}/transitions`, fields)

      onDone(response.data.data)
    } catch (error) {
      const problem = apiError(error, 'Could not update this trip.')
      setErrors(fieldErrors(problem))
      setFailure(problem.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      tone={destructive ? 'destructive' : 'default'}
      title={`${tripStatusLabel(to)} — trip #${trip.id}`}
      description={`${trip.origin} → ${trip.destination}, ${trip.vehicle?.registration_number ?? 'no vehicle'}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Back
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={submitting}
            disabled={incomplete || belowOpening}
            onClick={() => void submit()}
          >
            Confirm {tripStatusLabel(to).toLowerCase()}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {failure && Object.keys(errors).length === 0 && (
          <Alert tone="error" title="Not applied">
            {failure}
          </Alert>
        )}

        {needs.odometer && (
          <FormField
            label={needs.odometer === 'start' ? 'Opening odometer' : 'Closing odometer'}
            htmlFor="odometer"
            required
            hint={
              needs.odometer === 'end' && trip.odometer_start !== null
                ? `Opening reading was ${trip.odometer_start.toLocaleString('en-US')} km.`
                : 'Read from the dashboard before setting off.'
            }
            error={errors.odometer_start ?? errors.odometer_end}
          >
            <Input
              id="odometer"
              type="number"
              min={0}
              mono
              suffix="km"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              invalid={belowOpening}
              autoFocus
            />
          </FormField>
        )}

        {needs.odometer && (
          <FormField
            label="Dashboard photo"
            hint="Optional, but the Bank's records expect one alongside the reading."
            error={errors.odometer_photo}
          >
            <OdometerPhotoField file={photo} onChange={setPhoto} disabled={submitting} />
          </FormField>
        )}

        {belowOpening && (
          <Alert tone="warning" title="Closing reading is below the opening one">
            The trip started at {trip.odometer_start?.toLocaleString('en-US')} km, so the closing
            reading cannot be {reading.toLocaleString('en-US')} km.
          </Alert>
        )}

        <FormField
          label={needs.reason ? 'Reason' : 'Note'}
          htmlFor="notes"
          required={needs.reason}
          hint={
            needs.reason
              ? 'Recorded on the trip timeline against your name.'
              : 'Optional. Anything worth keeping on the timeline.'
          }
          error={errors.notes}
        >
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>
    </Dialog>
  )
}
