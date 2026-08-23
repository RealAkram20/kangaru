import { useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { Operator } from '../../types/operator'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'

/**
 * Onboarding a fleet company (ADR-0055, ADR-0059 §5).
 *
 * Three fields, and the two about a person are not optional. Acting as
 * assumes a person's identity — there is no "act as Shanitah", there is "act
 * as Shanitah's fleet owner" — so a fleet created with no account is
 * permanently unreachable to the people whose job is to support it. The
 * server refuses it; this form does not offer it.
 */
interface Props {
  onClose: () => void
  onDone: (fleet: Operator) => void
}

export function OnboardFleetDialog({ onClose, onDone }: Props) {
  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setFields({})

    try {
      const response = await apiClient.post<ApiSuccess<Operator>>('/operators', {
        name,
        owner_name: ownerName,
        owner_email: ownerEmail,
      })
      onDone(response.data.data)
    } catch (caught) {
      const failure = apiError(caught, 'Could not onboard this fleet.')
      setFields(fieldErrors(failure))
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Onboard fleet"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="onboard-fleet" disabled={saving}>
            {saving ? 'Onboarding…' : 'Onboard fleet'}
          </Button>
        </>
      }
    >
      <form id="onboard-fleet" onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="error">{error}</Alert>}

        <FormField label="Fleet name" required error={fields.name}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            invalid={fields.name !== undefined}
          />
        </FormField>

        <FormField label="Owner name" required error={fields.owner_name}>
          <Input
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
            required
            invalid={fields.owner_name !== undefined}
          />
        </FormField>

        <FormField label="Owner email" required error={fields.owner_email}>
          <Input
            type="email"
            value={ownerEmail}
            onChange={(event) => setOwnerEmail(event.target.value)}
            required
            invalid={fields.owner_email !== undefined}
          />
        </FormField>
      </form>
    </Dialog>
  )
}
