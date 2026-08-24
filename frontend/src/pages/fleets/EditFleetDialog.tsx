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
 * Correcting a fleet company (owner's ask, 24 August).
 *
 * ## Two fields, two endpoints, and the order is deliberate
 *
 * The name goes to `PATCH /operators/{id}`; the plan goes to
 * `PUT /operators/{id}/plan`, which is the only route that runs
 * `PlanAllowance` — the ADR-0058 §4 refusal of a downgrade below current
 * usage, whose 422 names the figures and renders under the picker here.
 * Name first, so the worse partial failure is the smaller one: a corrected
 * name on the old plan is a record somebody can finish, where a moved plan
 * under a name that never saved is a commercial change on a record that
 * still reads wrong.
 *
 * ## What is absent, and why absent rather than disabled
 *
 * No slug — it names the fleet in URLs and in an invoice series, so a
 * corrected trading name must not re-key either. No status — suspending is
 * a confirmed, destructive-styled act the record page owns, and offering it
 * again here as a dropdown would let the same decision skip its
 * confirmation. Same rule as the client dialog: a control nobody may use
 * invites the question every time it is seen.
 */
interface Props {
  fleet: Operator
  onClose: () => void
  onDone: (fleet: Operator) => void
}

export function EditFleetDialog({ fleet, onClose, onDone }: Props) {
  const [name, setName] = useState(fleet.name)
  const [planId, setPlanId] = useState(String(fleet.plan?.id ?? ''))
  const [plans, setPlans] = useState<Plan[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  useEffect(() => {
    apiClient
      .get<ApiSuccess<Plan[]>>('/plans')
      .then((response) => setPlans(response.data.data))
      .catch((caught: unknown) =>
        // Not swallowed — an empty picker looks like a broken control, which
        // is the failure the client dialog's fleet list already paid for.
        setError(apiError(caught, 'Could not load the plans.').message),
      )
  }, [])

  const nameChanged = name.trim() !== fleet.name
  const planChanged = planId !== '' && planId !== String(fleet.plan?.id ?? '')
  const changed = nameChanged || planChanged

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setFields({})

    try {
      let saved: Operator | null = null

      if (nameChanged) {
        saved = (
          await apiClient.patch<ApiSuccess<Operator>>(`/operators/${fleet.id}`, { name: name.trim() })
        ).data.data
      }

      if (planChanged) {
        saved = (
          await apiClient.put<ApiSuccess<Operator>>(`/operators/${fleet.id}/plan`, {
            plan_id: Number(planId),
          })
        ).data.data
      }

      onDone(saved ?? fleet)
    } catch (caught: unknown) {
      const failure = apiError(caught, 'Could not save this fleet.')
      setError(failure.message)
      setFields(fieldErrors(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Edit fleet"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="edit-fleet" disabled={saving || !changed}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="edit-fleet" onSubmit={save} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="error">{error}</Alert>}

        <FormField label="Fleet name" htmlFor="ef-name" required error={fields.name}>
          <Input
            id="ef-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            invalid={fields.name !== undefined}
          />
        </FormField>

        <FormField label="Plan" htmlFor="ef-plan" required error={fields.plan_id}>
          <Select
            id="ef-plan"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            options={plans.map((plan) => ({ value: String(plan.id), label: plan.name }))}
            invalid={fields.plan_id !== undefined}
          />
        </FormField>
      </form>
    </Dialog>
  )
}
