import { useEffect, useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { User } from '../../types/auth'
import type { Operator } from '../../types/operator'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { EmptyState } from '../../components/feedback/EmptyState'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'

/**
 * Becoming somebody at a fleet, for support (ADR-0056).
 *
 * ## Why this is a dialog and not a button
 *
 * Two things have to be chosen and neither has a safe default. **Who** —
 * because acting as assumes a person's identity, not an organisation's, so
 * "act as this fleet" has no meaning until a name is picked. And **why** —
 * the reason is required by the server, and `BeginImpersonationRequest`
 * explains that it is the first question an auditor asks a support log and
 * the cheapest moment to capture it is while somebody is already typing.
 *
 * The session lasts thirty minutes, the subject is told, and every action is
 * recorded against both names. The page says so once, in the confirm button,
 * rather than in a paragraph nobody reads twice (screen-rules §9).
 */
interface Props {
  fleet: Operator
  onClose: () => void
}

export function ActAsDialog({ fleet, onClose }: Props) {
  const [accounts, setAccounts] = useState<User[] | null>(null)
  const [subjectId, setSubjectId] = useState('')
  const [reason, setReason] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  useEffect(() => {
    apiClient
      .get<ApiSuccess<User[]>>(`/operators/${fleet.id}/accounts`)
      .then((response) => setAccounts(response.data.data))
      .catch(() => {
        setAccounts([])
        setError('Could not load this fleet’s accounts.')
      })
  }, [fleet.id])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setStarting(true)
    setError(null)
    setFields({})

    try {
      await apiClient.post('/support/act-as', {
        subject_id: Number(subjectId),
        reason,
      })
      // A full reload, matching `useActingAs().stop()`. Every screen behind
      // this was rendered as head office; continuing in place would leave a
      // support agent looking at their own console while the server has
      // already switched who they are.
      window.location.assign('/dashboard')
    } catch (caught) {
      const failure = apiError(caught, 'Could not start the session.')
      setFields(fieldErrors(failure))
      setError(failure.message)
      setStarting(false)
    }
  }

  const empty = accounts !== null && accounts.length === 0

  return (
    <Dialog
      title={`Log in as somebody at ${fleet.name}`}
      onClose={onClose}
      tone="warning"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button type="submit" form="act-as" disabled={starting || empty || subjectId === ''}>
            {starting ? 'Starting…' : 'Start 30-minute session'}
          </Button>
        </>
      }
    >
      {empty ? (
        // ADR-0059 §5 makes this state unreachable through onboarding, which
        // creates the first account in the same transaction. It is rendered
        // anyway, because an unreachable state that renders nothing is how a
        // support agent ends up staring at a dialog that does not work.
        <EmptyState
          icon="user-x"
          title="No accounts at this fleet"
          description="Support reaches a fleet through a person, so there is nobody to become here."
        />
      ) : (
        <form id="act-as" onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {error && <Alert tone="error">{error}</Alert>}

          <FormField label="Act as" required error={fields.subject_id}>
            <Select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              required
              disabled={accounts === null}
              placeholder={accounts === null ? 'Loading…' : 'Choose somebody'}
              // `options`, not children — `Select` builds its own <option>s,
              // and children are silently dropped. The dialog rendered an
              // empty picker with no error until it was opened in a browser.
              options={(accounts ?? []).map((account) => ({
                value: String(account.id),
                label: `${account.name} — ${account.role_label ?? account.role}`,
              }))}
            />
          </FormField>

          <FormField
            label="Reason"
            required
            error={fields.reason}
            hint="Recorded in the audit log against both names."
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              placeholder="Ticket reference and what you are checking"
              invalid={fields.reason !== undefined}
            />
          </FormField>
        </form>
      )}
    </Dialog>
  )
}
