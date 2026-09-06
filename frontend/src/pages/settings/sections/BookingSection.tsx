import { Input } from '../../../components/forms/Input'
import { Switch } from '../../../components/forms/Switch'
import { Row, SectionForm } from '../kit'
import { useSectionState } from '../state'
import type { SectionProps } from '../types'

export function BookingSection({ settings, onSaved, section }: SectionProps) {
  const state = useSectionState({
    approval_required: settings.booking.approval_required,
    max_advance_days: String(settings.booking.max_advance_days),
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      payload={() => ({
        approval_required: value.approval_required,
        max_advance_days: Number(value.max_advance_days),
      })}
    >
      {(errors) => (
        <>
          <Row
            label="Require approval before dispatch"
            htmlFor="settings-approval"
            hint="Off approves on creation, with no second pair of eyes."
          >
            <Switch
              id="settings-approval"
              checked={value.approval_required}
              onChange={(event) => set('approval_required', event.target.checked)}
            />
          </Row>

          <Row
            label="Maximum days in advance"
            htmlFor="settings-max-advance"
            hint="Bookings and the public order form alike."
            error={errors.max_advance_days}
            required
            control={120}
          >
            <Input
              id="settings-max-advance"
              type="number"
              min={1}
              max={365}
              value={value.max_advance_days}
              onChange={(event) => set('max_advance_days', event.target.value)}
              required
            />
          </Row>
        </>
      )}
    </SectionForm>
  )
}
