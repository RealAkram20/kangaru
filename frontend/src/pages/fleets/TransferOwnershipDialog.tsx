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
 * Naming a fleet's next owner (owner's decision, 24 August).
 *
 * *"Changing the email is changing the ownership"* — so this is its own
 * dialog and its own act, not a field on Edit fleet. Submitting sends the
 * welcome email and changes nothing else; the pending state renders on the
 * record page, where it can be withdrawn or replaced. The hint under the
 * email is the one sentence this form earns: without it, the person filling
 * it in has no way to know the handover is pending rather than immediate.
 */
interface Props {
  fleet: Operator
  onClose: () => void
  onDone: (fleet: Operator) => void
}

export function TransferOwnershipDialog({ fleet, onClose, onDone }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setFields({})

    try {
      const response = await apiClient.put<ApiSuccess<Operator>>(`/operators/${fleet.id}/owner`, {
        name,
        email,
      })
      onDone(response.data.data)
    } catch (caught: unknown) {
      const failure = apiError(caught, 'Could not send the invitation.')
      setError(failure.message)
      setFields(fieldErrors(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Transfer ownership"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="transfer-ownership" disabled={saving}>
            {saving ? 'Sending…' : 'Send invitation'}
          </Button>
        </>
      }
    >
      <form id="transfer-ownership" onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="error">{error}</Alert>}

        <FormField label="New owner" htmlFor="to-name" required error={fields.name}>
          <Input
            id="to-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            invalid={fields.name !== undefined}
          />
        </FormField>

        <FormField
          label="Email"
          htmlFor="to-email"
          required
          error={fields.email}
          hint="They set a password from this email. Until they do, nothing changes."
        >
          <Input
            id="to-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            invalid={fields.email !== undefined}
          />
        </FormField>
      </form>
    </Dialog>
  )
}
