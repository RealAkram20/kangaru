import { useEffect, useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { User } from '../../types/auth'
import { Button } from '../core/Button'
import { Alert } from '../feedback/Alert'
import { Dialog } from '../feedback/Dialog'
import { EmptyState } from '../feedback/EmptyState'
import { FormField } from '../forms/FormField'
import { Input } from '../forms/Input'
import { Select } from '../forms/Select'

/**
 * Becoming somebody at an organisation, for support (ADR-0056).
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
 *
 * ## Why it lives here rather than under `pages/fleets`
 *
 * It was a fleet dialog until head office needed the same thing at a corporate
 * client, and the owner's description in ADR-0056 always named both — *"can log
 * in as to any fleet, corporate client, walk-in client and drivers."* Nothing
 * in the form was ever fleet-shaped: it fetches a roster from a URL and posts a
 * subject and a reason. Copying it per organisation kind is how the two copies
 * drift, and the half that drifts is the wording about what is being recorded.
 *
 * So the caller supplies the **heading** and the **roster URL**, and nothing
 * else. It deliberately does not accept the endpoint's shape, a success
 * callback or a redirect: starting a session changes who the whole console is,
 * so there is exactly one thing to do afterwards and it is not the caller's to
 * choose.
 */
interface Props {
  /** Names the organisation in the heading — "Log in as somebody at {title}". */
  title: string
  /** Where this organisation's people are listed. Answers `ApiSuccess<User[]>`. */
  accountsUrl: string
  /** What to say when the roster comes back empty, in this organisation's own words. */
  emptyDescription?: string
  onClose: () => void
}

export function ActAsDialog({ title, accountsUrl, emptyDescription, onClose }: Props) {
  const [accounts, setAccounts] = useState<User[] | null>(null)
  const [subjectId, setSubjectId] = useState('')
  const [reason, setReason] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  useEffect(() => {
    apiClient
      .get<ApiSuccess<User[]>>(accountsUrl)
      .then((response) => setAccounts(response.data.data))
      .catch(() => {
        setAccounts([])
        setError('Could not load this organisation’s accounts.')
      })
  }, [accountsUrl])

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
      title={`Log in as somebody at ${title}`}
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
        // For a fleet, ADR-0059 §5 makes this state unreachable through
        // onboarding, which creates the first account in the same transaction;
        // ADR-0062 §3 does the same for a client. It is rendered anyway,
        // because an unreachable state that renders nothing is how a support
        // agent ends up staring at a dialog that does not work.
        <EmptyState
          icon="user-x"
          title="Nobody to become here"
          description={
            emptyDescription ?? 'Support reaches an organisation through a person, and this one has no accounts.'
          }
        />
      ) : (
        <form id="act-as" onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {error && <Alert tone="error">{error}</Alert>}

          {/*
            `htmlFor` and a matching `id`, which this dialog went without until
            it was queried by label in a test. `FormField` treats `htmlFor` as
            optional and renders a `<label>` pointing at nothing when it is
            omitted — the field still looks labelled and still annotates
            `aria-required`, so nothing visibly breaks, but the control has no
            accessible **name**. A screen reader announces the picker that
            decides whose identity is about to be assumed as an unlabelled
            combo box.
          */}
          <FormField label="Act as" htmlFor="act-as-subject" required error={fields.subject_id}>
            <Select
              id="act-as-subject"
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
            htmlFor="act-as-reason"
            required
            error={fields.reason}
            hint="Recorded in the audit log against both names."
          >
            <Input
              id="act-as-reason"
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
