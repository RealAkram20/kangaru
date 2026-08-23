import { useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { Company } from '../../types/company'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'

/**
 * Correcting a corporate client's details (ADR-0062).
 *
 * ## What is here, and what is deliberately not
 *
 * The client's **identity and billing contact** — the directory facts, which
 * are what `CorporateClientsPage` shows and therefore what somebody reading it
 * can see is wrong.
 *
 * Not the credit limit, and not the status. The page's own docblock draws that
 * line for the reading side and it holds harder for the writing side: a credit
 * limit is a fleet's judgement about its customer, and suspending a client
 * stops them booking, which is the fleet's commercial call with its own
 * customer. Head office is not a party to either. Both remain absent rather
 * than disabled — a control nobody may use is worse than no control, because
 * it invites the question every time.
 *
 * ## The registration number is editable, and it is the one that can collide
 *
 * It is the client's platform-wide identity (ADR-0060 §1), so a typo in it is
 * exactly the thing most worth being able to correct — and the thing most
 * worth refusing when the correction is somebody else's number.
 * `UpdateCompanyRequest` now carries the `unique` rule the column has always
 * had, so a collision arrives as an error under this field instead of the
 * integrity-constraint 500 it used to be.
 *
 * ## Only what changed is sent
 *
 * PATCH semantics, and not a stylistic preference: the endpoint accepts every
 * field as `sometimes`, so sending the whole form would re-assert values
 * nobody touched — and re-asserting an unchanged registration number is enough
 * to make a `unique` rule refuse an edit that changed only the city.
 */
interface Props {
  client: Company
  onClose: () => void
  onDone: (client: Company) => void
}

const EDITABLE = ['legal_name', 'trading_name', 'registration_number', 'city', 'country', 'billing_email'] as const

type Editable = (typeof EDITABLE)[number]

export function EditClientDialog({ client, onClose, onDone }: Props) {
  const [form, setForm] = useState<Record<Editable, string>>({
    legal_name: client.legal_name,
    trading_name: client.trading_name ?? '',
    registration_number: client.registration_number ?? '',
    city: client.city,
    country: client.country,
    billing_email: client.billing_email,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  const set = (key: Editable) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  // Compared against what the client actually holds, with the same
  // empty-string-means-null reading the inputs use, so clearing an optional
  // field registers as a change and re-typing the original does not.
  const original = (key: Editable) =>
    key === 'trading_name' || key === 'registration_number' ? (client[key] ?? '') : client[key]

  const changed = EDITABLE.filter((key) => form[key].trim() !== original(key))

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setFields({})

    const patch = Object.fromEntries(
      changed.map((key) => {
        const value = form[key].trim()
        // The two nullable fields, emptied on purpose. Sending `''` would
        // store an empty string where the column means "not recorded", and
        // the table's em-dash placeholder would stop appearing.
        const nullable = key === 'trading_name' || key === 'registration_number'
        return [key, nullable && value === '' ? null : value]
      }),
    )

    try {
      const response = await apiClient.patch<ApiSuccess<Company>>(`/companies/${client.id}`, patch)
      onDone(response.data.data)
    } catch (caught: unknown) {
      const failure = apiError(caught, 'Could not save the client.')
      setError(failure.message)
      setFields(fieldErrors(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Edit client"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="edit-client" disabled={saving || changed.length === 0}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="edit-client" onSubmit={save} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="error">{error}</Alert>}

        <FormField label="Legal name" htmlFor="ec-legal" required error={fields.legal_name}>
          <Input id="ec-legal" value={form.legal_name} onChange={set('legal_name')} required autoFocus />
        </FormField>

        <FormField label="Trading name" htmlFor="ec-trading" error={fields.trading_name}>
          <Input id="ec-trading" value={form.trading_name} onChange={set('trading_name')} />
        </FormField>

        <FormField label="Registration number" htmlFor="ec-reg" error={fields.registration_number}>
          <Input
            id="ec-reg"
            value={form.registration_number}
            onChange={set('registration_number')}
            mono
            invalid={fields.registration_number !== undefined}
          />
        </FormField>

        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: '2fr 1fr' }}>
          <FormField label="City" htmlFor="ec-city" required error={fields.city}>
            <Input id="ec-city" value={form.city} onChange={set('city')} required />
          </FormField>
          <FormField label="Country" htmlFor="ec-country" required error={fields.country}>
            <Input id="ec-country" value={form.country} onChange={set('country')} required maxLength={2} />
          </FormField>
        </div>

        <FormField label="Billing email" htmlFor="ec-billing" required error={fields.billing_email}>
          <Input
            id="ec-billing"
            type="email"
            value={form.billing_email}
            onChange={set('billing_email')}
            required
          />
        </FormField>
      </form>
    </Dialog>
  )
}
