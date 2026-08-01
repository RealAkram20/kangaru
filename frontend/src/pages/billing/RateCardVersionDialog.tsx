import { useState } from 'react'
import { Button } from '../../components/core/Button'
import { Icon } from '../../components/core/Icon'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { ROUNDING_OPTIONS, VEHICLE_CATEGORIES } from '../../lib/billing'
import type { ApiSuccess } from '../../types/api'
import type { RateCard, RateCardVersion, RoundingMode } from '../../types/billing'

interface RateDraft {
  vehicle_category: string
  base_fare_minor: string
  per_km_minor: string
  per_waiting_minute_minor: string
  minimum_charge_minor: string
  maximum_charge_minor: string
}

function emptyRate(category: string): RateDraft {
  return {
    vehicle_category: category,
    base_fare_minor: '',
    per_km_minor: '',
    per_waiting_minute_minor: '',
    minimum_charge_minor: '',
    maximum_charge_minor: '',
  }
}

/** Blank means zero for a rate, and "uncapped" for the maximum. */
function toMinor(value: string): number {
  return value.trim() === '' ? 0 : Math.round(Number(value))
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
 */
export function RateCardVersionDialog({
  card,
  onClose,
  onSaved,
}: {
  /** Null creates a new card; otherwise a version is added to this one. */
  card: RateCard | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const creating = card === null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [makeDefault, setMakeDefault] = useState('no')
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [rounding, setRounding] = useState<RoundingMode>('half_up')
  const [freeWaiting, setFreeWaiting] = useState('0')
  const [nightFrom, setNightFrom] = useState('')
  const [nightTo, setNightTo] = useState('')
  const [nightMultiplier, setNightMultiplier] = useState('1.25')
  const [rates, setRates] = useState<RateDraft[]>([emptyRate('sedan')])

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Validation error keys are nested under `version.` when creating a card
  // and bare when adding a version, matching the two request classes.
  const prefix = creating ? 'version.' : ''
  const nightEnabled = nightFrom !== '' || nightTo !== ''

  const usedCategories = new Set(rates.map((r) => r.vehicle_category))
  const availableCategory = VEHICLE_CATEGORIES.find((c) => !usedCategories.has(c))

  const duplicateCategory = usedCategories.size !== rates.length
  const incomplete =
    (creating && name.trim() === '') ||
    effectiveFrom === '' ||
    rates.length === 0 ||
    duplicateCategory ||
    (nightEnabled && (nightFrom === '' || nightTo === ''))

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
      base_fare_minor: toMinor(rate.base_fare_minor),
      per_km_minor: toMinor(rate.per_km_minor),
      per_waiting_minute_minor: toMinor(rate.per_waiting_minute_minor),
      minimum_charge_minor: toMinor(rate.minimum_charge_minor),
      // Null, not zero: zero would mean every trip on this category is free.
      maximum_charge_minor: rate.maximum_charge_minor.trim() === '' ? null : toMinor(rate.maximum_charge_minor),
    })),
  })

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
      } else {
        const response = await apiClient.post<ApiSuccess<RateCardVersion>>(
          `/rate-cards/${card.id}/versions`,
          versionPayload(),
        )
        onSaved(`Version ${response.data.data.version} added to "${card.name}".`)
      }
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
      width={820}
      title={creating ? 'New rate card' : `New version of "${card.name}"`}
      description={
        creating
          ? 'A card is created together with its first priced version — a card that prices nothing cannot invoice anything.'
          : 'The current version is left untouched. Every invoice already raised keeps pointing at it.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Back
          </Button>
          <Button loading={submitting} disabled={incomplete} onClick={() => void submit()}>
            {creating ? 'Create rate card' : 'Add version'}
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

        <Alert tone="info" title="Prices here are permanent">
          A version cannot be edited once created. Correcting a mistake means adding another version, and
          any invoice raised in between keeps the figures it was billed under.
        </Alert>

        {creating && (
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
          </div>
        )}

        {creating && (
          <FormField label="Description" htmlFor="rc-description" error={errors.description}>
            <Input
              id="rc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Default corporate rates"
            />
          </FormField>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--space-4)' }}>
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
          <FormField label="Rounding" htmlFor="rc-rounding" error={errors[`${prefix}rounding_mode`]}>
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

        <fieldset style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
          <legend style={{ font: 'var(--type-label)', color: 'var(--text-secondary)', padding: '0 6px' }}>
            Night rate
          </legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 'var(--space-4)' }}>
            <FormField
              label="From"
              htmlFor="rc-nightfrom"
              hint="Leave both blank for no night rate."
              error={errors[`${prefix}night_starts_at`]}
            >
              <Input id="rc-nightfrom" type="time" value={nightFrom} onChange={(e) => setNightFrom(e.target.value)} />
            </FormField>
            <FormField label="To" htmlFor="rc-nightto" error={errors[`${prefix}night_ends_at`]}>
              <Input id="rc-nightto" type="time" value={nightTo} onChange={(e) => setNightTo(e.target.value)} />
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
            <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
              This window wraps midnight, which is expected for a night rate.
            </p>
          )}
        </fieldset>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span style={{ font: 'var(--type-label)', color: 'var(--text-secondary)' }}>
              Prices per vehicle category — whole shillings (UGX)
            </span>
            <Button
              size="sm"
              variant="secondary"
              iconLeft="plus"
              disabled={availableCategory === undefined}
              onClick={() => availableCategory && setRates([...rates, emptyRate(availableCategory)])}
            >
              Add category
            </Button>
          </div>

          {duplicateCategory && (
            <Alert tone="warning" title="A category is priced twice">
              Each vehicle category may appear once. Two rows for one category would leave it ambiguous which
              price applies.
            </Alert>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {rates.map((rate, index) => (
              <div
                key={index}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr) auto',
                  gap: 'var(--space-2)',
                  alignItems: 'end',
                }}
              >
                <FormField label={index === 0 ? 'Category' : undefined} error={errors[`${prefix}rates.${index}.vehicle_category`]}>
                  <Select
                    size="sm"
                    value={rate.vehicle_category}
                    onChange={(e) => {
                      const next = [...rates]
                      next[index] = { ...rate, vehicle_category: e.target.value }
                      setRates(next)
                    }}
                    options={VEHICLE_CATEGORIES.map((c) => ({ value: c, label: c }))}
                  />
                </FormField>
                {(
                  [
                    ['base_fare_minor', 'Base fare'],
                    ['per_km_minor', 'Per km'],
                    ['per_waiting_minute_minor', 'Per wait min'],
                    ['minimum_charge_minor', 'Minimum'],
                    ['maximum_charge_minor', 'Maximum'],
                  ] as const
                ).map(([field, label]) => (
                  <FormField
                    key={field}
                    label={index === 0 ? label : undefined}
                    error={errors[`${prefix}rates.${index}.${field}`]}
                  >
                    <Input
                      size="sm"
                      type="number"
                      min={0}
                      step={1}
                      mono
                      placeholder={field === 'maximum_charge_minor' ? 'none' : '0'}
                      value={rate[field]}
                      onChange={(e) => {
                        const next = [...rates]
                        next[index] = { ...rate, [field]: e.target.value }
                        setRates(next)
                      }}
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
                    color: rates.length === 1 ? 'var(--text-placeholder)' : 'var(--text-secondary)',
                    cursor: rates.length === 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Icon name="trash-2" size={14} />
                </button>
              </div>
            ))}
          </div>

          <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
            UGX is a zero-decimal currency, so the figure you type is the figure stored — no cents, no
            conversion. Leave Maximum blank for no cap.
          </p>
        </div>
      </div>
    </Dialog>
  )
}
