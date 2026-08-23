import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import type { ApiSuccess } from '../../types/api'
import type { Company } from '../../types/company'
import type { Operator } from '../../types/operator'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'

/**
 * Onboarding a corporate client (ADR-0060, ADR-0062 §3).
 *
 * ## The registration number is asked first, and everything waits on it
 *
 * Not a field among fields. ADR-0060 §2 is explicit that a form asking for it
 * last is a form where somebody types the client's whole profile, hits save,
 * and is told the company already exists — at which point the pressure to work
 * around the check is highest and the easiest workaround is a slightly
 * different spelling of the name.
 *
 * So the rest of the form is disabled until the lookup has answered, and the
 * lookup answers a boolean: **taken** or **free**. Nothing about the client
 * appears here on a match, because *"is Centenary on Kangaru?"* is not a
 * question one fleet may ask about another fleet's client.
 */
interface Props {
  onClose: () => void
  onDone: (client: Company) => void
}

type Lookup = 'idle' | 'checking' | 'free' | 'taken'

export function OnboardClientDialog({ onClose, onDone }: Props) {
  const { user } = useAuth()
  const isHeadOffice = user?.access_level === 'kangaru'

  const [registration, setRegistration] = useState('')
  // The answer, tagged with the term it answers. Kept as a fact and never as
  // a status, so the status below can be **derived** rather than assigned —
  // setting state synchronously inside the effect triggers cascading renders,
  // and the "checking" and "idle" transitions are the two that would.
  const [checked, setChecked] = useState<{ term: string; exists: boolean } | null>(null)
  const [fleets, setFleets] = useState<Operator[]>([])
  const [form, setForm] = useState({
    legal_name: '',
    trading_name: '',
    city: '',
    country: 'UG',
    billing_email: '',
    admin_name: '',
    admin_email: '',
    operator_id: '',
  })
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  const debounced = useDebouncedValue(registration.trim(), 400)

  useEffect(() => {
    if (debounced.length < 3) return

    apiClient
      .get<ApiSuccess<{ exists: boolean }>>('/clients/lookup', {
        params: { registration_number: debounced },
      })
      .then((response) => setChecked({ term: debounced, exists: response.data.data.exists }))
      // Nothing recorded rather than a guess either way: claiming "free" on a
      // dropped request invites a duplicate, and claiming "taken" blocks a
      // legitimate onboarding. It stays at `checking`, the submit stays shut,
      // and the server refuses a duplicate regardless.
      .catch(() => {})
  }, [debounced])

  // Derived, so the two transitions that would otherwise be synchronous
  // setState calls inside the effect are not state at all. A stale answer for
  // a previous term reads as `checking`, which is exactly right — it is what
  // the form knows, not what it last knew.
  const lookup: Lookup =
    debounced.length < 3
      ? 'idle'
      : checked?.term === debounced
        ? checked.exists
          ? 'taken'
          : 'free'
        : 'checking'

  // Head office must name the fleet (ADR-0062 §3), so it needs the list. A
  // fleet does not: its own contract is the only one it could mean.
  useEffect(() => {
    if (!isHeadOffice) return
    apiClient
      .get<ApiSuccess<Operator[]>>('/operators')
      .then((response) => setFleets(response.data.data))
      .catch(() => setFleets([]))
  }, [isHeadOffice])

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  async function onboard(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setFields({})

    try {
      const response = await apiClient.post<ApiSuccess<Company>>('/companies', {
        registration_number: registration.trim(),
        ...form,
        trading_name: form.trading_name || null,
        ...(isHeadOffice ? { operator_id: Number(form.operator_id) } : {}),
      })
      onDone(response.data.data)
    } catch (caught) {
      const failure = apiError(caught, 'Could not onboard this client.')
      setFields(fieldErrors(failure))
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  async function askToServe() {
    setAsking(true)
    setError(null)

    try {
      await apiClient.post('/contracts', { registration_number: registration.trim() })
      onClose()
    } catch (caught) {
      setError(apiError(caught, 'Could not send the request.').message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <Dialog
      title="Onboard client"
      onClose={onClose}
      width={560}
      footer={
        lookup === 'taken' && !isHeadOffice ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={asking}>
              Cancel
            </Button>
            <Button disabled={asking} onClick={() => void askToServe()}>
              {asking ? 'Sending…' : 'Request to serve them'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {/*
              * Refused while the number is TAKEN, rather than until it is
              * known free. An empty or half-typed number leaves the button
              * live so the browser's own `required` validation fires and puts
              * the cursor in the field that is missing - a disabled button
              * fires nothing and explains nothing.
              */}
            <Button type="submit" form="onboard-client" disabled={saving || lookup === 'taken'}>
              {saving ? 'Onboarding…' : 'Onboard client'}
            </Button>
          </>
        )
      }
    >
      <form id="onboard-client" onSubmit={onboard} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="error">{error}</Alert>}

        <FormField
          label="Registration number"
          htmlFor="oc-reg"
          required
          error={fields.registration_number}
          hint={
            lookup === 'taken'
              ? 'This company is already on Kangaru.'
              : lookup === 'free'
                ? 'Not on Kangaru yet.'
                : 'The company registration or TIN. Everything else waits on this.'
          }
        >
          <Input
            id="oc-reg"
            value={registration}
            onChange={(event) => setRegistration(event.target.value)}
            autoFocus
            required
            mono
            invalid={fields.registration_number !== undefined}
          />
        </FormField>

        {lookup === 'taken' && !isHeadOffice && (
          // Deliberately says nothing about them — not the name, not the city,
          // not who serves them (ADR-0060 §4). The fleet learns exactly what it
          // knew before: the number is taken.
          <Alert tone="info">
            They already have an account. You can ask to serve them — they decide.
          </Alert>
        )}

        {lookup === 'taken' && isHeadOffice && (
          <Alert tone="warning">This registration number already belongs to a client.</Alert>
        )}

        {/*
          * Not a disabled fieldset any more, and the reason is worth keeping.
          *
          * ADR-0060 section 2 asked for the registration number to be answered
          * first, and this form implemented that by switching everything else
          * off until the lookup replied. In a browser that reads as broken:
          * the owner clicked "Served by", nothing happened, and reported the
          * picker as faulty - twice. A styled control cannot show a fieldset's
          * disabled state (its shell paints from its own prop), but even with
          * that fixed, a form whose fields go dead in a particular order is a
          * form people fight.
          *
          * The ADR's actual protection is kept and moved to where it bites:
          * the number is still asked first, still looked up live, and still
          * says "taken" before anybody types a profile - and onboarding is
          * refused while it is taken. What is gone is the pre-emptive
          * disabling of six fields that were never the risk.
          *
          * The server is the real gate regardless: `OnboardClientRequest`
          * carries `Rule::unique`, so a duplicate is a 422 on the field even
          * if the lookup never ran.
          */}
        <fieldset style={{ display: 'grid', gap: 'var(--space-4)', border: 0, padding: 0, margin: 0 }}>
          {isHeadOffice && (
            <FormField
              label="Served by"
              htmlFor="oc-fleet"
              required
              error={fields.operator_id}
              hint="Every client needs a fleet from the moment it exists."
            >
              <Select
                id="oc-fleet"
                value={form.operator_id}
                onChange={set('operator_id')}
                required
                placeholder="Choose a fleet company"
                options={fleets.map((fleet) => ({ value: String(fleet.id), label: fleet.name }))}
              />
            </FormField>
          )}

          <FormField label="Legal name" htmlFor="oc-legal" required error={fields.legal_name}>
            <Input id="oc-legal" value={form.legal_name} onChange={set('legal_name')} required />
          </FormField>

          <FormField label="Trading name" htmlFor="oc-trading" error={fields.trading_name}>
            <Input id="oc-trading" value={form.trading_name} onChange={set('trading_name')} />
          </FormField>

          <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: '2fr 1fr' }}>
            <FormField label="City" htmlFor="oc-city" required error={fields.city}>
              <Input id="oc-city" value={form.city} onChange={set('city')} required />
            </FormField>
            <FormField label="Country" htmlFor="oc-country" required error={fields.country}>
              <Input id="oc-country" value={form.country} onChange={set('country')} required maxLength={2} />
            </FormField>
          </div>

          <FormField label="Billing email" htmlFor="oc-billing" required error={fields.billing_email}>
            <Input id="oc-billing" type="email" value={form.billing_email} onChange={set('billing_email')} required />
          </FormField>

          <FormField
            label="Their administrator"
            htmlFor="oc-admin"
            required
            error={fields.admin_name}
            hint="They are invited to set their own password."
          >
            <Input id="oc-admin" value={form.admin_name} onChange={set('admin_name')} required />
          </FormField>

          <FormField label="Administrator email" htmlFor="oc-admin-email" required error={fields.admin_email}>
            <Input
              id="oc-admin-email"
              type="email"
              value={form.admin_email}
              onChange={set('admin_email')}
              required
            />
          </FormField>
        </fieldset>
      </form>
    </Dialog>
  )
}
