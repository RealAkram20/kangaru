import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { Company } from '../../types/company'
import type { Operator } from '../../types/operator'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { Checkbox } from '../../components/forms/Checkbox'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'

/**
 * Correcting a corporate client (ADR-0062).
 *
 * ## The same shape as onboarding, deliberately
 *
 * Field for field and in the same order as `OnboardClientDialog`: registration
 * number, served by, legal name, trading name, city and country, billing
 * email. A person who has onboarded a client this week should not have to
 * re-learn where anything is to fix a typo in it, and two forms about one
 * thing that disagree about the order of that thing read as two different
 * records.
 *
 * ## Served by is a set of tick boxes, not a picker
 *
 * *"we can asign multer fleetcompanies, so we need the ability to select and
 * unselect multiple providers"* — the owner, 24 August. A client may be served
 * by several fleets (ADR-0060 §1), so the control has to be able to say so,
 * and a `<select>` cannot say "these two and not that one" without a keyboard
 * modifier nobody discovers.
 *
 * Tick boxes rather than a multi-select for the same reason: **unselecting has
 * to be as visible as selecting.** In a multi-select, removing a fleet is
 * ctrl-clicking a highlighted row, which is the least discoverable interaction
 * on the platform and the one with the largest consequence here.
 *
 * The onboarding form keeps its single picker on purpose. It is choosing the
 * *first* fleet for a client that does not exist yet, where "which one" is the
 * only question there is; adding the second is this form's job.
 *
 * ## What this overturned, and on whose authority
 *
 * ADR-0060 §5 gave the contract to the client — *"not Kangaru's"* — and
 * `OperatorClientPolicy::end()` said head office *"is not a party to a
 * contract between two other organisations."* That governed a **fleet asking**
 * to serve somebody else's client, and it still does: `ContractController`
 * is untouched and a fleet still cannot take a client.
 *
 * The owner's decision adds the case it did not cover. Head office already
 * names the first fleet at onboarding, so it is already choosing a supplier —
 * and with no way to change it, a client onboarded onto the wrong fleet stayed
 * there for ever.
 *
 * ## What is absent, and why absent rather than disabled
 *
 * No credit limit, no status, and no administrator. The first two are the
 * fleet's judgement and the fleet's commercial call with its own customer; the
 * last creates a login, which is an act on a person rather than a fact about a
 * company. A control nobody may use invites the question every time it is
 * seen, so none of them is here to be greyed out.
 *
 * ## Only what changed is sent
 *
 * The endpoint takes every field as `sometimes`, so sending the whole form
 * would re-assert values nobody touched — and re-asserting an unchanged
 * registration number is one `ignore()` away from refusing an edit that
 * changed only the city.
 */
interface Props {
  client: Company
  onClose: () => void
  onDone: (client: Company) => void
}

const EDITABLE = ['registration_number', 'legal_name', 'trading_name', 'city', 'country', 'billing_email'] as const

type Editable = (typeof EDITABLE)[number]

const NULLABLE: readonly Editable[] = ['trading_name', 'registration_number']

export function EditClientDialog({ client, onClose, onDone }: Props) {
  const { user } = useAuth()
  const isHeadOffice = user?.access_level === 'kangaru'

  const [form, setForm] = useState<Record<Editable, string>>({
    registration_number: client.registration_number ?? '',
    legal_name: client.legal_name,
    trading_name: client.trading_name ?? '',
    city: client.city,
    country: client.country,
    billing_email: client.billing_email,
  })
  const [fleets, setFleets] = useState<Operator[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  const set = (key: Editable) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  // Compared against what the client actually holds, reading an empty string
  // as null the way the inputs do, so clearing an optional field registers as
  // a change and re-typing the original does not.
  const original = (key: Editable) => (NULLABLE.includes(key) ? (client[key] ?? '') : client[key])

  const profileChanged = EDITABLE.filter((key) => form[key].trim() !== original(key))

  const servedBy = useMemo(() => (client.served_by ?? []).map((fleet) => fleet.id), [client.served_by])
  const [selected, setSelected] = useState<number[]>(servedBy)

  const toggle = (id: number) =>
    setSelected((current) => (current.includes(id) ? current.filter((held) => held !== id) : [...current, id]))

  // Compared as sets: unticking a fleet and re-ticking it is not a change, and
  // it would be one under an array comparison that respected order.
  const fleetsChanged =
    selected.length !== servedBy.length || selected.some((id) => !servedBy.includes(id))

  const changed = profileChanged.length > 0 || (isHeadOffice && fleetsChanged)

  // Head office must not be able to save a client with nobody serving it
  // (ADR-0062 §3) - a client with no fleet books and is never dispatched, and
  // nothing anywhere errors. The request refuses it too; this is so the refusal
  // arrives before the round trip rather than after it.
  const strandsTheClient = isHeadOffice && selected.length === 0

  // Head office only. A fleet's own console has no picker at all: its own
  // contract is the only one it could mean, and it may not set anybody's
  // (`CompanyPolicy::assignFleets`).
  useEffect(() => {
    if (!isHeadOffice) return
    apiClient
      .get<ApiSuccess<Operator[]>>('/operators')
      .then((response) => setFleets(response.data.data))
      .catch((caught: unknown) =>
        // Not swallowed. The onboarding dialog swallowed the same failure and
        // rendered an empty picker that looked like a broken control, which
        // cost the owner two bug reports.
        setError(apiError(caught, 'Could not load the fleet companies.').message),
      )
  }, [isHeadOffice])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setFields({})

    const patch = Object.fromEntries(
      profileChanged.map((key) => {
        const value = form[key].trim()
        // Emptied on purpose means "not recorded", which is what the nullable
        // column says. Storing `''` instead would quietly retire the table's
        // em-dash placeholder.
        return [key, NULLABLE.includes(key) && value === '' ? null : value]
      }),
    )

    try {
      /*
       * Two requests, and the fleets go second on purpose.
       *
       * They are separate endpoints because they are separate acts (see
       * `ClientFleetController`), so this is the one place their order is
       * decided. Profile first means the worse failure is the one that leaves
       * less behind: a corrected name with the old fleets is a client somebody
       * can look at and finish, where a re-sourced client whose name never
       * saved is a relationship changed on a record that still reads wrong.
       */
      let saved: Company | null = null

      if (profileChanged.length > 0) {
        saved = (await apiClient.patch<ApiSuccess<Company>>(`/companies/${client.id}`, patch)).data.data
      }

      if (isHeadOffice && fleetsChanged) {
        saved = (
          await apiClient.put<ApiSuccess<Company>>(`/companies/${client.id}/fleets`, {
            operator_ids: selected,
          })
        ).data.data
      }

      onDone(saved ?? client)
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
          <Button type="submit" form="edit-client" disabled={saving || !changed || strandsTheClient}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="edit-client" onSubmit={save} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="error">{error}</Alert>}

        <FormField
          label="Registration number"
          htmlFor="ec-reg"
          error={fields.registration_number}
          hint="The company registration or TIN."
        >
          <Input
            id="ec-reg"
            value={form.registration_number}
            onChange={set('registration_number')}
            autoFocus
            mono
            invalid={fields.registration_number !== undefined}
          />
        </FormField>

        {isHeadOffice && (
          <FormField
            label="Served by"
            required
            error={fields.operator_ids}
            hint="Every client needs a fleet from the moment it exists."
          >
            <div
              role="group"
              aria-label="Served by"
              style={{
                display: 'grid',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                // Capped so a platform with forty fleets does not produce a
                // dialog taller than the window, with the save button under
                // the fold and no way to reach it.
                maxHeight: '168px',
                overflowY: 'auto',
                background: 'var(--surface-card)',
                border: '1px solid var(--border-input)',
                borderRadius: 'var(--radius-input)',
              }}
            >
              {fleets.map((fleet) => (
                <Checkbox
                  key={fleet.id}
                  id={`ec-fleet-${fleet.id}`}
                  label={fleet.name}
                  checked={selected.includes(fleet.id)}
                  onChange={() => toggle(fleet.id)}
                />
              ))}
            </div>
          </FormField>
        )}

        <FormField label="Legal name" htmlFor="ec-legal" required error={fields.legal_name}>
          <Input id="ec-legal" value={form.legal_name} onChange={set('legal_name')} required />
        </FormField>

        <FormField label="Trading name" htmlFor="ec-trading" error={fields.trading_name}>
          <Input id="ec-trading" value={form.trading_name} onChange={set('trading_name')} />
        </FormField>

        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: '2fr 1fr' }}>
          <FormField label="City" htmlFor="ec-city" required error={fields.city}>
            <Input id="ec-city" value={form.city} onChange={set('city')} required />
          </FormField>
          {/* The hint earns its place here more than anywhere: clients from
              before the ISO commitment hold "Uganda" spelt out, and an input
              that shows six letters while accepting two is a stuck control
              with no explanation. */}
          <FormField
            label="Country"
            htmlFor="ec-country"
            required
            error={fields.country}
            hint="Two-letter code, e.g. UG."
          >
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
