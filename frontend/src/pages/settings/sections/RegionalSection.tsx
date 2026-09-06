import { Input } from '../../../components/forms/Input'
import { Row, SectionForm } from '../kit'
import { useSectionState } from '../state'
import type { SectionProps } from '../types'

export function RegionalSection({ settings, onSaved, section }: SectionProps) {
  const state = useSectionState({
    currency: settings.regional.currency,
    timezone: settings.regional.timezone,
    date_format: settings.regional.date_format,
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      payload={() => ({
        currency: value.currency,
        timezone: value.timezone,
        date_format: value.date_format,
      })}
    >
      {(errors) => (
        <>
          <Row
            label="Currency"
            htmlFor="settings-currency"
            hint="ISO 4217 code."
            error={errors.currency}
            required
            control={120}
          >
            <Input
              id="settings-currency"
              value={value.currency}
              onChange={(event) => set('currency', event.target.value.toUpperCase())}
              maxLength={3}
              placeholder="UGX"
              mono
              required
            />
          </Row>

          <Row
            label="Timezone"
            htmlFor="settings-timezone"
            hint="IANA name."
            error={errors.timezone}
            required
            control={280}
          >
            <Input
              id="settings-timezone"
              value={value.timezone}
              onChange={(event) => set('timezone', event.target.value)}
              placeholder="Africa/Kampala"
              mono
              required
            />
          </Row>

          <Row
            label="Date format"
            htmlFor="settings-date-format"
            error={errors.date_format}
            required
            control={200}
          >
            <Input
              id="settings-date-format"
              value={value.date_format}
              onChange={(event) => set('date_format', event.target.value)}
              placeholder="DD MMM YYYY"
              mono
              required
            />
          </Row>
        </>
      )}
    </SectionForm>
  )
}
