import { useState } from 'react'
import { apiClient, clearStoredCustomerToken } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { Button } from '../core/Button'
import { Alert } from '../feedback/Alert'
import { Dialog } from '../feedback/Dialog'
import { FormField } from '../forms/FormField'
import { Input } from '../forms/Input'

/**
 * Holding a walk-in customer's account, for support (ADR-0066).
 *
 * ## Why this is not `ActAsDialog` with a different URL
 *
 * That dialog asks two questions because an organisation is not a person —
 * "act as this fleet" has no meaning until a name is picked from a roster. A
 * walk-in **is** the person. There is no roster, nothing to choose, and a
 * picker with one option in it is a question that should not have been asked.
 *
 * What is left is the half that does not vary: the reason, which the server
 * requires and which `BeginImpersonationRequest` calls the first question an
 * auditor asks a support log.
 *
 * ## What it says, and why it says more than the other one
 *
 * The corporate dialog warns in one line, in the confirm button. This one
 * carries a sentence as well, because what it starts is materially different:
 * ADR-0066 §2 gives support **full reach minus the identity acts**, so from
 * here a support agent can cancel a real ride and order a real car on a member
 * of the public's account. An agent who did not realise that is the failure
 * this paragraph exists to prevent, and it is the one place in the console
 * where the reach is stated rather than implied.
 *
 * ## The stale customer token
 *
 * Cleared before the reload. `apiClient` prefers a stored customer token over
 * the staff one on `/customer/*`, which is right — a real walk-in signed in on
 * this browser must never be displaced by a staff session. It has the wrong
 * effect here: the agent would be sent to the order flow and served as
 * whichever customer last signed in on this machine, with the banner naming
 * somebody else entirely.
 */
interface Props {
  customer: { id: number; name: string }
  onClose: () => void
}

export function ActAsWalkInDialog({ customer, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setStarting(true)
    setError(null)
    setFields({})

    try {
      await apiClient.post('/support/act-as', {
        subject_type: 'customer',
        subject_id: customer.id,
        reason,
      })

      clearStoredCustomerToken()

      // The order flow, not `/dashboard`. A walk-in has no console — the staff
      // one answers 403 for everything but the banner while this session is
      // live (ADR-0066 §5) — so sending the agent there would show them a wall
      // of refusals and nothing they came to see.
      window.location.assign('/order')
    } catch (caught) {
      const failure = apiError(caught, 'Could not start the session.')
      setFields(fieldErrors(failure))
      setError(failure.message)
      setStarting(false)
    }
  }

  return (
    <Dialog
      title={`Log in as ${customer.name}`}
      onClose={onClose}
      tone="warning"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button type="submit" form="act-as-walk-in" disabled={starting || reason.trim().length < 8}>
            {starting ? 'Starting…' : 'Start 30-minute session'}
          </Button>
        </>
      }
    >
      <form id="act-as-walk-in" onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="error">{error}</Alert>}

        <Alert tone="warning">
          You will be able to see this customer’s orders and their live ride, cancel it, and place an
          order for them. You cannot change their password or sign them out. They are emailed that
          you opened their account, and everything you do is recorded against your name as well as
          theirs.
        </Alert>

        <FormField
          label="Reason"
          htmlFor="act-as-walk-in-reason"
          required
          error={fields.reason}
          hint="Recorded in the audit log against both names."
        >
          <Input
            id="act-as-walk-in-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            placeholder="Ticket reference and what you are trying to fix"
            invalid={fields.reason !== undefined}
          />
        </FormField>
      </form>
    </Dialog>
  )
}
