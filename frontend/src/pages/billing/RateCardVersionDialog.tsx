import { useEffect, useState } from 'react'
import { Button } from '../../components/core/Button'
import { Icon } from '../../components/core/Icon'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { ROUNDING_OPTIONS } from '../../lib/billing'
import { categoryOptions, useVehicleCategories } from '../../lib/vehicleCategories'
import type { ApiSuccess } from '../../types/api'
import type { RateCard, RateCardVersion, RoundingMode } from '../../types/billing'
import { isPriceableZone, type Zone } from '../../types/zone'

/**
 * The five amounts a rate carries, in the order they read on an invoice.
 *
 * One list, used for a category's default price and for a zone price alike,
 * because the backend stores them in one shape and serialises them through
 * one function. Two lists would be where a field quietly stops being sent.
 */
const AMOUNT_FIELDS = [
  ['base_fare_minor', 'Base fare'],
  ['per_km_minor', 'Per km'],
  ['per_waiting_minute_minor', 'Per wait min'],
  ['minimum_charge_minor', 'Minimum'],
  ['maximum_charge_minor', 'Maximum'],
] as const

type AmountField = (typeof AMOUNT_FIELDS)[number][0]

type AmountDraft = Record<AmountField, string>

interface ZoneRateDraft extends AmountDraft {
  /** Empty until a zone is chosen; the form blocks submitting in that state. */
  zone_id: string
}

interface RateDraft extends AmountDraft {
  vehicle_category: string
  zone_rates: ZoneRateDraft[]
}

function emptyAmounts(): AmountDraft {
  return {
    base_fare_minor: '',
    per_km_minor: '',
    per_waiting_minute_minor: '',
    minimum_charge_minor: '',
    maximum_charge_minor: '',
  }
}

function emptyRate(category: string): RateDraft {
  return { vehicle_category: category, ...emptyAmounts(), zone_rates: [] }
}

/**
 * A stored amount as the form's string, and **`null` as blank rather than
 * "0"**.
 *
 * The two are not the same claim anywhere in this dialog: blank means
 * "uncapped" for a maximum, and `toMinor` turns it back into null on submit.
 * Prefilling a null maximum as "0" would silently cap every trip on that
 * category at nothing.
 */
function amountToDraft(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * The latest version's prices, as a set of drafts to edit.
 *
 * **This is what "editing a rate card" means here.** Prices are immutable —
 * `PricedRate` throws on update and the card's own subtitle says a version is
 * never edited — so the honest version of the request is: start from what the
 * prices are now, change the figures, and save a *new* version. Retyping six
 * categories from scratch to change one number is how a finance officer
 * introduces a typo into a tariff.
 *
 * The result is still an ordinary create. Nothing here mutates the version it
 * copied, and the old one stays exactly as it was for every invoice already
 * priced by it.
 */
function draftsFromVersion(version: RateCardVersion): RateDraft[] {
  return (version.rates ?? []).map((rate) => ({
    vehicle_category: rate.vehicle_category,
    base_fare_minor: amountToDraft(rate.base_fare_minor),
    per_km_minor: amountToDraft(rate.per_km_minor),
    per_waiting_minute_minor: amountToDraft(rate.per_waiting_minute_minor),
    minimum_charge_minor: amountToDraft(rate.minimum_charge_minor),
    maximum_charge_minor: amountToDraft(rate.maximum_charge_minor),
    zone_rates: (rate.zone_rates ?? []).map((zoneRate) => ({
      zone_id: String(zoneRate.zone_id),
      base_fare_minor: amountToDraft(zoneRate.base_fare_minor),
      per_km_minor: amountToDraft(zoneRate.per_km_minor),
      per_waiting_minute_minor: amountToDraft(zoneRate.per_waiting_minute_minor),
      minimum_charge_minor: amountToDraft(zoneRate.minimum_charge_minor),
      maximum_charge_minor: amountToDraft(zoneRate.maximum_charge_minor),
    })),
  }))
}

/** Blank means zero for a rate, and "uncapped" for the maximum. */
function toMinor(value: string): number {
  return value.trim() === '' ? 0 : Math.round(Number(value))
}

function amountsPayload(draft: AmountDraft) {
  return {
    base_fare_minor: toMinor(draft.base_fare_minor),
    per_km_minor: toMinor(draft.per_km_minor),
    per_waiting_minute_minor: toMinor(draft.per_waiting_minute_minor),
    minimum_charge_minor: toMinor(draft.minimum_charge_minor),
    // Null, not zero: zero would mean every trip on this rate is free.
    maximum_charge_minor:
      draft.maximum_charge_minor.trim() === '' ? null : toMinor(draft.maximum_charge_minor),
  }
}

/**
 * Creates a rate card with its first priced version, or adds a version to
 * an existing card.
 *
 * One dialog for both, because the payload is the same shape and the
 * backend shares one rule set (StoreRateCardVersionRequest::versionRules).
 * Two forms would be two things to keep in step with it.
 *
 * There is no "edit" mode and there never will be: AGENTS.md requires a
 * rate card version to be immutable, so changing prices means adding a
 * version and leaving every invoice already raised pointing at the old one.
 *
 * Zone prices (ADR-0021) sit **inside** the category they override, exactly
 * as they do in storage and in the request body. A flat list would leave the
 * user to work out which default a zone price replaces, and getting that
 * wrong shows a finance officer a price that is not the one being charged.
 */
export function RateCardVersionDialog({
  card,
  addCategory,
  onClose,
  onSaved,
}: {
  /** Null creates a new card; otherwise a version is added to this one. */
  card: RateCard | null
  /**
   * A category key to open with, already added as a blank row (ADR-0050 §5).
   *
   * Set when the vehicle categories screen sent somebody here from "Price
   * it" on a category this card does not price. A rate card version is
   * immutable, so there is no way to add a price to the version that exists
   * — the only mechanism is a new version, and this saves the officer from
   * having to work out which of the nine rows is missing.
   *
   * It is added **blank**, never at zero: a zero base fare and zero per-km
   * is a free trip, and `docs/screen-rules.md` §1 forbids substituting a
   * number for one nobody has decided.
   */
  addCategory?: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const creating = card === null

  /*
   * **One form for create and edit**, rather than a small "details" dialog
   * beside a big "prices" one.
   *
   * The owner opened the two side by side and said so: creating a rate card is
   * a single form carrying its name, its description and its prices, and
   * editing one should not be a different, smaller thing. Splitting them made
   * the immutability rule the *shape of the UI*, which is the wrong place for
   * it — the rule belongs in what Save does, not in how many dialogs a person
   * has to find.
   *
   * So both modes render the same fields, and Save does the minimum writes the
   * change actually needs. See `submit()`.
   */

  /*
   * The version a new one starts from.
   *
   * Versions arrive newest first, and the newest is what a trip run today
   * prices at — so it is the only sensible thing to copy. Null when creating a
   * card, or when the card somehow has no version yet, and the form then opens
   * blank exactly as it always did.
   */
  const basis = card?.versions?.[0] ?? null

  const [name, setName] = useState(card?.name ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [status, setStatus] = useState<RateCard['status']>(card?.status ?? 'active')
  const [makeDefault, setMakeDefault] = useState('no')
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [rounding, setRounding] = useState<RoundingMode>(basis?.rounding_mode ?? 'half_up')
  const [freeWaiting, setFreeWaiting] = useState(String(basis?.free_waiting_minutes ?? 0))
  // "22:00:00" from the server, "22:00" in a time input.
  const [nightFrom, setNightFrom] = useState(basis?.night_starts_at?.slice(0, 5) ?? '')
  const [nightTo, setNightTo] = useState(basis?.night_ends_at?.slice(0, 5) ?? '')
  const [nightMultiplier, setNightMultiplier] = useState(
    basis === null ? '1.25' : String(basis.night_multiplier_bp / 10_000),
  )
  /*
   * **Prefilled from the current prices when adding a version.**
   *
   * Prices are immutable, so "edit this rate card" can only ever mean "make a
   * new version that differs from the current one" — and making somebody
   * retype six vehicle categories to change one figure is how a typo gets into
   * a tariff. The lazy initialiser runs once on mount, which is right: this is
   * a starting point to edit, not a live mirror of the card.
   *
   * Nothing about immutability moves. The copied version is untouched and
   * every invoice already priced by it stays reproducible; what is submitted
   * is an ordinary new version.
   */
  const [rates, setRates] = useState<RateDraft[]>(() => {
    const copied = basis !== null && (basis.rates ?? []).length > 0 ? draftsFromVersion(basis) : []

    // The category somebody arrived here to price, appended blank — unless
    // this version already prices it, in which case they were sent by a
    // stale screen and a second row would be a duplicate the server refuses.
    const missing =
      addCategory !== undefined && !copied.some((rate) => rate.vehicle_category === addCategory)
        ? [emptyRate(addCategory)]
        : []

    // A brand-new card with no basis and no requested category still opens
    // with one empty row to fill in, as it always did. It is blank rather
    // than defaulted to `sedan`: the office's first category may not be a
    // sedan, and a preselected value is one somebody has to notice is wrong.
    return copied.length + missing.length > 0 ? [...copied, ...missing] : [emptyRate('')]
  })
  const [zones, setZones] = useState<Zone[]>([])
  // ADR-0050. One fetch for every category select in this dialog; a failure
  // leaves the selects empty and disabled rather than offering a stale list
  // the server would refuse.
  const { categories, error: categoriesError } = useVehicleCategories()

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The on-mount load uses the `.then()` shape DriversPage documents rather
  // than async/await, so the state update lands in a callback instead of
  // cascading a render straight out of the effect body.
  //
  // A failure here is deliberately silent: zones are an optional refinement
  // of a rate card, and a finance officer whose role cannot read them (or
  // whose network blipped) must still be able to set ordinary prices. The
  // section below explains its own absence instead.
  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<Zone[]>>('/zones')
      .then((response) => {
        if (!cancelled) setZones(response.data.data.filter(isPriceableZone))
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Validation error keys are nested under `version.` when creating a card
  // and bare when adding a version, matching the two request classes.
  const prefix = creating ? 'version.' : ''
  const nightEnabled = nightFrom !== '' || nightTo !== ''

  const usedCategories = new Set(rates.map((r) => r.vehicle_category))
  // ADR-0050: the fleet's live vocabulary, not a literal. The list this
  // replaced was one of four hand-mirrored copies, two of which had drifted.
  const options = categoryOptions(categories ?? [])
  const availableCategory = options.find((option) => !usedCategories.has(option.value))?.value

  const duplicateCategory = usedCategories.size !== rates.length
  const zoneRateIncomplete = rates.some((rate) => rate.zone_rates.some((z) => z.zone_id === ''))
  const duplicateZone = rates.some(
    (rate) => new Set(rate.zone_rates.map((z) => z.zone_id)).size !== rate.zone_rates.length,
  )

  const incomplete =
    name.trim() === '' ||
    effectiveFrom === '' ||
    rates.length === 0 ||
    // A row with no category chosen. Reachable since ADR-0050 made the
    // first row open blank rather than defaulted to `sedan`; the server
    // refuses it, and being refused after typing five figures is worse than
    // a disabled Save that says which row is unfinished.
    rates.some((rate) => rate.vehicle_category === '') ||
    duplicateCategory ||
    duplicateZone ||
    zoneRateIncomplete ||
    (nightEnabled && (nightFrom === '' || nightTo === ''))

  const updateRate = (index: number, next: RateDraft) =>
    setRates(rates.map((rate, i) => (i === index ? next : rate)))

  const versionPayload = () => ({
    effective_from: effectiveFrom,
    rounding_mode: rounding,
    free_waiting_minutes: toMinor(freeWaiting),
    night_starts_at: nightEnabled ? nightFrom : null,
    night_ends_at: nightEnabled ? nightTo : null,
    // Basis points, an integer. The form takes a friendly "1.25" and
    // converts once, here — a multiplier is never stored as a float.
    night_multiplier_bp: nightEnabled ? Math.round(Number(nightMultiplier) * 10_000) : 10_000,
    rates: rates.map((rate) => ({
      vehicle_category: rate.vehicle_category,
      ...amountsPayload(rate),
      zone_rates: rate.zone_rates.map((zoneRate) => ({
        zone_id: Number(zoneRate.zone_id),
        ...amountsPayload(zoneRate),
      })),
    })),
  })

  /**
   * Whether the *prices* differ from the version this form was filled from.
   *
   * **`effective_from` is excluded on purpose.** The form defaults it to today
   * while the basis carries whatever date it was set live on, so including it
   * would make every open of this dialog look like a change — and a rename
   * would silently add a version identical to the one before it. The date says
   * *when* a change applies; if nothing changed, it is answering a question
   * nobody asked.
   */
  const pricesChanged = (): boolean => {
    if (basis === null) return true

    const now = versionPayload()
    const before = {
      rounding_mode: basis.rounding_mode,
      free_waiting_minutes: basis.free_waiting_minutes,
      night_starts_at: basis.night_starts_at === null ? null : basis.night_starts_at.slice(0, 5),
      night_ends_at: basis.night_ends_at === null ? null : basis.night_ends_at.slice(0, 5),
      night_multiplier_bp: basis.night_multiplier_bp,
      rates: (basis.rates ?? []).map((rate) => ({
        vehicle_category: rate.vehicle_category,
        base_fare_minor: rate.base_fare_minor,
        per_km_minor: rate.per_km_minor,
        per_waiting_minute_minor: rate.per_waiting_minute_minor,
        minimum_charge_minor: rate.minimum_charge_minor,
        maximum_charge_minor: rate.maximum_charge_minor,
        zone_rates: (rate.zone_rates ?? []).map((zoneRate) => ({
          zone_id: zoneRate.zone_id,
          base_fare_minor: zoneRate.base_fare_minor,
          per_km_minor: zoneRate.per_km_minor,
          per_waiting_minute_minor: zoneRate.per_waiting_minute_minor,
          minimum_charge_minor: zoneRate.minimum_charge_minor,
          maximum_charge_minor: zoneRate.maximum_charge_minor,
        })),
      })),
    }

    const comparable = { ...now, effective_from: undefined }

    return JSON.stringify(comparable) !== JSON.stringify({ ...before, effective_from: undefined })
  }

  const detailsChanged = (): boolean =>
    card !== null &&
    (name.trim() !== card.name ||
      (description.trim() === '' ? null : description.trim()) !== (card.description ?? null) ||
      status !== card.status)

  /**
   * One Save, and **the minimum writes the change actually needs.**
   *
   * This is where the immutability rule lives now that the UI no longer
   * enforces it by being two dialogs. A rename is a `PATCH` and nothing else;
   * a price change adds a version and never touches the old one; changing both
   * does both, and the message says which happened so nobody has to guess
   * whether a version was created.
   *
   * **Renaming must not add a version.** Doing so would fill the card's history
   * with versions identical to the one before them, and a pricing history where
   * most entries changed no price is one nobody can read a real change out of.
   */
  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setFailure(null)

    try {
      if (creating) {
        const response = await apiClient.post<ApiSuccess<RateCard>>('/rate-cards', {
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
          is_default: makeDefault === 'yes',
          version: versionPayload(),
        })
        onSaved(`Rate card "${response.data.data.name}" created.`)

        return
      }

      const renamed = detailsChanged()
      const repriced = pricesChanged()

      if (renamed) {
        await apiClient.patch<ApiSuccess<RateCard>>(`/rate-cards/${card.id}`, {
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
          status,
        })
      }

      /*
       * The details first, then the version. If the version is refused —
       * validation, or a rate card that has since been locked — the rename has
       * landed and the prices have not, which is the safe half to keep: a card
       * with the wrong name prices correctly, and the error names what failed.
       * The other order would leave a version priced under a name that was
       * never saved.
       */
      if (repriced) {
        const response = await apiClient.post<ApiSuccess<RateCardVersion>>(
          `/rate-cards/${card.id}/versions`,
          versionPayload(),
        )

        onSaved(
          renamed
            ? `"${name.trim()}" updated, and version ${response.data.data.version} added.`
            : `Version ${response.data.data.version} added to "${name.trim()}".`,
        )

        return
      }

      onSaved(
        renamed
          ? `"${name.trim()}" updated. Prices are unchanged, so no version was added.`
          : 'Nothing changed.',
      )
    } catch (error) {
      const problem = apiError(error, 'Could not save this rate card.')
      setErrors(fieldErrors(problem))
      setFailure(problem.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      width={980}
      title={creating ? 'New rate card' : `Edit "${card.name}"`}
      description={
        creating
          ? 'A card is created together with its first priced version — a card that prices nothing cannot invoice anything.'
          : 'Name, description and prices — the same form the card was created with. Changing a price adds a version; the current one is left untouched, and every invoice already raised keeps pointing at it.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Back
          </Button>
          <Button loading={submitting} disabled={incomplete} onClick={() => void submit()}>
            {creating ? 'Create rate card' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {failure && Object.keys(errors).length === 0 && (
          <Alert tone="error" title="Not saved">
            {failure}
          </Alert>
        )}

        {categoriesError !== null && (
          <Alert tone="error" title="Categories unavailable">
            {categoriesError} A version prices vehicle categories, so it cannot be saved until the
            list loads — reload the page and try again.
          </Alert>
        )}

        <Alert tone="info" title="Prices here are permanent">
          A version cannot be edited once created. Correcting a mistake means adding another
          version, and any invoice raised in between keeps the figures it was billed under.
        </Alert>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>
          <FormField label="Card name" htmlFor="rc-name" required error={errors.name}>
            <Input
              id="rc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Corporate Standard"
              autoFocus
            />
          </FormField>

          {/*
            On create this asks whether the new card becomes the default; on
            edit it becomes the card's status. Both are the one "what is this
            card for" control in the same slot, and neither is a price.

            **`is_default` is deliberately not editable here.** Promoting a card
            must demote whichever card currently holds the flag, in the same
            transaction, and `PUT /rate-cards/{id}/default` owns that — it is
            already the *Make default* button on the card itself. A second way
            in is the one that forgets to demote.
          */}
          {creating ? (
            <FormField
              label="Make this the default"
              htmlFor="rc-default"
              hint="The card used when a trip is invoiced without naming one."
            >
              <Select
                id="rc-default"
                value={makeDefault}
                onChange={(e) => setMakeDefault(e.target.value)}
                options={[
                  { value: 'no', label: 'No' },
                  { value: 'yes', label: 'Yes' },
                ]}
              />
            </FormField>
          ) : (
            <FormField
              label="Status"
              htmlFor="rc-status"
              hint="Archived cards stay readable, so past invoices remain explicable."
              error={errors.status}
            >
              <Select
                id="rc-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as RateCard['status'])}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                ]}
              />
            </FormField>
          )}
        </div>

        <FormField label="Description" htmlFor="rc-description" error={errors.description}>
          <Input
            id="rc-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Default corporate rates"
          />
        </FormField>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <FormField
            label="Effective from"
            htmlFor="rc-effective"
            required
            hint="A trip is priced by the version in force on the day it ran."
            error={errors[`${prefix}effective_from`]}
          >
            <Input
              id="rc-effective"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </FormField>
          <FormField
            label="Rounding"
            htmlFor="rc-rounding"
            error={errors[`${prefix}rounding_mode`]}
          >
            <Select
              id="rc-rounding"
              value={rounding}
              onChange={(e) => setRounding(e.target.value as RoundingMode)}
              options={ROUNDING_OPTIONS}
            />
          </FormField>
          <FormField
            label="Free waiting minutes"
            htmlFor="rc-freewait"
            hint="Deducted from the waiting time on the trip timeline."
            error={errors[`${prefix}free_waiting_minutes`]}
          >
            <Input
              id="rc-freewait"
              type="number"
              min={0}
              step={1}
              mono
              suffix="min"
              value={freeWaiting}
              onChange={(e) => setFreeWaiting(e.target.value)}
            />
          </FormField>
        </div>

        <fieldset
          style={{
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
          }}
        >
          <legend
            style={{ font: 'var(--type-label)', color: 'var(--text-secondary)', padding: '0 6px' }}
          >
            Night rate
          </legend>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            <FormField
              label="From"
              htmlFor="rc-nightfrom"
              hint="Leave both blank for none."
              error={errors[`${prefix}night_starts_at`]}
            >
              <Input
                id="rc-nightfrom"
                type="time"
                value={nightFrom}
                onChange={(e) => setNightFrom(e.target.value)}
              />
            </FormField>
            <FormField label="To" htmlFor="rc-nightto" error={errors[`${prefix}night_ends_at`]}>
              <Input
                id="rc-nightto"
                type="time"
                value={nightTo}
                onChange={(e) => setNightTo(e.target.value)}
              />
            </FormField>
            <FormField
              label="Multiplier"
              htmlFor="rc-nightmult"
              hint="Applied to base fare and distance, never to waiting time."
              error={errors[`${prefix}night_multiplier_bp`]}
            >
              <Input
                id="rc-nightmult"
                type="number"
                min={1}
                max={5}
                step={0.05}
                mono
                suffix="x"
                disabled={!nightEnabled}
                value={nightMultiplier}
                onChange={(e) => setNightMultiplier(e.target.value)}
              />
            </FormField>
          </div>
          {nightEnabled && nightFrom !== '' && nightTo !== '' && nightFrom > nightTo && (
            <p
              style={{
                font: 'var(--type-caption)',
                color: 'var(--text-secondary)',
                marginTop: 'var(--space-2)',
              }}
            >
              This window wraps midnight, which is expected for a night rate.
            </p>
          )}
        </fieldset>

        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-2)',
            }}
          >
            <span style={{ font: 'var(--type-label)', color: 'var(--text-secondary)' }}>
              Prices per vehicle category — whole shillings (UGX)
            </span>
            <Button
              size="sm"
              variant="secondary"
              iconLeft="plus"
              disabled={availableCategory === undefined}
              onClick={() =>
                availableCategory && setRates([...rates, emptyRate(availableCategory)])
              }
            >
              Add category
            </Button>
          </div>

          {duplicateCategory && (
            <Alert tone="warning" title="A category is priced twice">
              Each vehicle category may appear once. Two rows for one category would leave it
              ambiguous which price applies.
            </Alert>
          )}

          {duplicateZone && (
            <Alert tone="warning" title="A zone is priced twice">
              Each zone may appear once per vehicle category, for the same reason: two prices for
              one zone leave it ambiguous which one a trip picked up there is charged.
            </Alert>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {rates.map((rate, index) => (
              <div
                key={index}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, minmax(0, 1fr)) auto',
                    gap: 'var(--space-2)',
                    alignItems: 'end',
                  }}
                >
                  <FormField
                    label="Category"
                    style={{ minWidth: 0 }}
                    htmlFor={`rc-rate-${index}-category`}
                    error={errors[`${prefix}rates.${index}.vehicle_category`]}
                  >
                    <Select
                      id={`rc-rate-${index}-category`}
                      size="sm"
                      value={rate.vehicle_category}
                      onChange={(e) =>
                        updateRate(index, { ...rate, vehicle_category: e.target.value })
                      }
                      // `alsoAllow` is this row's own value, so a version
                      // copied from one that priced a since-retired category
                      // still shows it. Without it the select would fall
                      // back to rendering its first option, silently
                      // changing which category the officer is editing.
                      options={categoryOptions(categories ?? [], rate.vehicle_category)}
                      placeholder={categories === null ? 'Loading…' : 'Choose a category'}
                    />
                  </FormField>
                  {AMOUNT_FIELDS.map(([field, label]) => (
                    <FormField
                      key={field}
                      label={label}
                      style={{ minWidth: 0 }}
                      htmlFor={`rc-rate-${index}-${field}`}
                      error={errors[`${prefix}rates.${index}.${field}`]}
                    >
                      <Input
                        id={`rc-rate-${index}-${field}`}
                        size="sm"
                        type="number"
                        min={0}
                        step={1}
                        mono
                        placeholder={field === 'maximum_charge_minor' ? 'none' : '0'}
                        value={rate[field]}
                        onChange={(e) => updateRate(index, { ...rate, [field]: e.target.value })}
                      />
                    </FormField>
                  ))}
                  <button
                    type="button"
                    aria-label={`Remove ${rate.vehicle_category}`}
                    disabled={rates.length === 1}
                    onClick={() => setRates(rates.filter((_, i) => i !== index))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      height: 'var(--control-h-sm)',
                      padding: '0 8px',
                      border: 'none',
                      background: 'transparent',
                      color:
                        rates.length === 1 ? 'var(--text-placeholder)' : 'var(--text-secondary)',
                      cursor: rates.length === 1 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <Icon name="trash-2" size={14} />
                  </button>
                </div>

                <ZonePrices
                  rate={rate}
                  rateIndex={index}
                  zones={zones}
                  errorFor={(zoneIndex, field) =>
                    errors[`${prefix}rates.${index}.zone_rates.${zoneIndex}.${field}`]
                  }
                  onChange={(next) => updateRate(index, next)}
                />
              </div>
            ))}
          </div>

          <p
            style={{
              font: 'var(--type-caption)',
              color: 'var(--text-secondary)',
              marginTop: 'var(--space-3)',
            }}
          >
            UGX is a zero-decimal currency, so the figure you type is the figure stored — no cents,
            no conversion. Leave Maximum blank for no cap.
          </p>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * The zone prices for one vehicle category.
 *
 * A zone price replaces the row above it in full rather than adjusting it,
 * so every field is asked for again. That is deliberate on the backend too:
 * a partial override would mean no single row ever states what a trip in
 * this zone costs, and reconstructing a disputed price would need two rows
 * and a merge rule.
 */
function ZonePrices({
  rate,
  rateIndex,
  zones,
  errorFor,
  onChange,
}: {
  rate: RateDraft
  /** Only for building control ids that are unique across the whole form. */
  rateIndex: number
  zones: Zone[]
  errorFor: (zoneIndex: number, field: string) => string | undefined
  onChange: (next: RateDraft) => void
}) {
  const chosen = new Set(rate.zone_rates.map((z) => z.zone_id))
  const nextZone = zones.find((zone) => !chosen.has(String(zone.id)))

  const update = (index: number, next: ZoneRateDraft) =>
    onChange({ ...rate, zone_rates: rate.zone_rates.map((z, i) => (i === index ? next : z)) })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          Zone prices — charged instead of the row above when the pickup is inside the zone
        </span>
        <Button
          size="sm"
          variant="ghost"
          iconLeft="plus"
          disabled={nextZone === undefined}
          onClick={() =>
            nextZone &&
            onChange({
              ...rate,
              zone_rates: [...rate.zone_rates, { zone_id: String(nextZone.id), ...emptyAmounts() }],
            })
          }
        >
          Add zone price
        </Button>
      </div>

      {zones.length === 0 && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          No pricing zones have been drawn yet, so there is nothing to price differently. Trips are
          charged the rates above wherever they start.
        </p>
      )}

      {rate.zone_rates.map((zoneRate, zoneIndex) => (
        <div
          key={zoneIndex}
          style={{
            display: 'grid',
            // The zone column carries names, not five-digit figures, so it
            // gets the room the amounts do not need.
            gridTemplateColumns: 'minmax(0, 1.6fr) repeat(5, minmax(0, 1fr)) auto',
            gap: 'var(--space-2)',
            alignItems: 'end',
          }}
        >
          {/* The column headings are shown once and every row below reads
              from position. `labelHidden` keeps each control's accessible
              name — a screen reader has no alignment to read from. */}
          <FormField
            label="Zone"
            style={{ minWidth: 0 }}
            labelHidden={zoneIndex > 0}
            htmlFor={`rc-zone-${rateIndex}-${zoneIndex}-id`}
            error={errorFor(zoneIndex, 'zone_id')}
          >
            <Select
              id={`rc-zone-${rateIndex}-${zoneIndex}-id`}
              size="sm"
              value={zoneRate.zone_id}
              onChange={(e) => update(zoneIndex, { ...zoneRate, zone_id: e.target.value })}
              options={zones.map((zone) => ({ value: String(zone.id), label: zone.name }))}
            />
          </FormField>
          {AMOUNT_FIELDS.map(([field, label]) => (
            <FormField
              key={field}
              label={label}
              style={{ minWidth: 0 }}
              labelHidden={zoneIndex > 0}
              htmlFor={`rc-zone-${rateIndex}-${zoneIndex}-${field}`}
              error={errorFor(zoneIndex, field)}
            >
              <Input
                id={`rc-zone-${rateIndex}-${zoneIndex}-${field}`}
                size="sm"
                type="number"
                min={0}
                step={1}
                mono
                placeholder={field === 'maximum_charge_minor' ? 'none' : '0'}
                value={zoneRate[field]}
                onChange={(e) => update(zoneIndex, { ...zoneRate, [field]: e.target.value })}
              />
            </FormField>
          ))}
          <button
            type="button"
            aria-label={`Remove zone price ${zoneIndex + 1} for ${rate.vehicle_category}`}
            onClick={() =>
              onChange({ ...rate, zone_rates: rate.zone_rates.filter((_, i) => i !== zoneIndex) })
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 'var(--control-h-sm)',
              padding: '0 8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <Icon name="trash-2" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
