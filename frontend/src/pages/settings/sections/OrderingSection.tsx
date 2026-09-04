import { Input } from '../../../components/forms/Input'
import { Switch } from '../../../components/forms/Switch'
import { Row, SectionForm } from '../kit'
import { useSectionState } from '../state'
import type { SectionProps } from '../types'

export function OrderingSection({ settings, onSaved, section }: SectionProps) {
  const state = useSectionState({
    walk_in_enabled: settings.ordering.walk_in_enabled,
    rate_limit_per_minute: String(settings.ordering.rate_limit_per_minute),
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      payload={() => ({
        walk_in_enabled: value.walk_in_enabled,
        rate_limit_per_minute: Number(value.rate_limit_per_minute),
      })}
    >
      {(errors) => (
        <>
          <Row
            label="Accept online orders"
            htmlFor="settings-walk-in"
            hint="Off pauses the form. Queued orders are unaffected."
          >
            <Switch
              id="settings-walk-in"
              checked={value.walk_in_enabled}
              onChange={(event) => set('walk_in_enabled', event.target.checked)}
            />
          </Row>

          <Row
            label="Orders per minute, per visitor"
            htmlFor="settings-rate-limit"
            hint="Per IP address."
            error={errors.rate_limit_per_minute}
            required
            control={120}
          >
            <Input
              id="settings-rate-limit"
              type="number"
              min={1}
              max={60}
              value={value.rate_limit_per_minute}
              onChange={(event) => set('rate_limit_per_minute', event.target.value)}
              required
            />
          </Row>
        </>
      )}
    </SectionForm>
  )
}
