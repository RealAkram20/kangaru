import { useEffect, useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { Operator } from '../../types/operator'
import type { Plan } from '../../types/plan'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'

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
  const [plans, setPlans] = useState<Plan[]>([])
  const [planId, setPlanId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  // The plan is chosen here since the owner asked for it (24 August),
  // pre-selected to the default the server would have assigned anyway —
  // so the picker adds a choice without adding a required decision.
  useEffect(() => {
    apiClient
      .get<ApiSuccess<Plan[]>>('/plans')
      .then((response) => {
        setPlans(response.data.data)
        const fallback = response.data.data.find((plan) => plan.is_default)
        if (fallback) setPlanId((current) => (current === '' ? String(fallback.id) : current))
      })
      .catch((caught: unknown) =>
        // Not swallowed — an empty picker looks like a broken control.
        setError(apiError(caught, 'Could not load the plans.').message),
      )
  }, [])

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
        // Omitted while the catalogue has not answered: the server assigns
        // the default, which is the same plan the picker would have shown.
        ...(planId === '' ? {} : { plan_id: Number(planId) }),
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

        {/* `htmlFor`/`id` on all four: these labels were never associated
            with their controls, so a screen reader announced three bare
            text boxes (docs/screen-rules.md §6). */}
        <FormField label="Fleet name" htmlFor="of-name" required error={fields.name}>
          <Input
            id="of-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            invalid={fields.name !== undefined}
          />
        </FormField>

        <FormField label="Plan" htmlFor="of-plan" required error={fields.plan_id}>
          <Select
            id="of-plan"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            options={plans.map((plan) => ({ value: String(plan.id), label: plan.name }))}
            invalid={fields.plan_id !== undefined}
          />
        </FormField>

        <FormField label="Owner name" htmlFor="of-owner-name" required error={fields.owner_name}>
          <Input
            id="of-owner-name"
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
            required
            invalid={fields.owner_name !== undefined}
          />
        </FormField>

        <FormField label="Owner email" htmlFor="of-owner-email" required error={fields.owner_email}>
          <Input
            id="of-owner-email"
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
