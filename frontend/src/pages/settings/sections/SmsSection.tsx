import { Input } from '../../../components/forms/Input'
import { Select } from '../../../components/forms/Select'
import { Row, SecretRow, SectionForm } from '../kit'
import { orNull, useSectionState, withSecrets } from '../state'
import type { SectionProps } from '../types'

export function SmsSection({ settings, onSaved, section }: SectionProps) {
  const sms = settings.sms
  const state = useSectionState({
    // Widened to `string`, not narrowed to the union: the value comes back
    // from a `<select>` as a string, and the server is the thing that decides
    // which providers exist.
    provider: (sms.provider ?? '') as string,
    sender_id: sms.sender_id ?? '',
    api_key: '',
    api_secret: '',
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      secretKeys={['api_key', 'api_secret']}
      payload={() =>
        withSecrets(
          { provider: orNull(value.provider), sender_id: orNull(value.sender_id) },
          { api_key: value.api_key, api_secret: value.api_secret },
        )
      }
    >
      {(errors) => (
        <>
          <Row label="Provider" htmlFor="settings-sms-provider" error={errors.provider} control={320}>
            <Select
              id="settings-sms-provider"
              value={value.provider}
              onChange={(event) => set('provider', event.target.value)}
              placeholder="Not chosen yet"
              options={[
                { value: 'africastalking', label: "Africa's Talking" },
                { value: 'twilio', label: 'Twilio' },
              ]}
            />
          </Row>

          <Row
            label="Sender ID"
            htmlFor="settings-sms-sender"
            hint="As registered with the provider."
            error={errors.sender_id}
            control={280}
          >
            <Input
              id="settings-sms-sender"
              value={value.sender_id}
              onChange={(event) => set('sender_id', event.target.value)}
            />
          </Row>

          <SecretRow
            label="API key"
            htmlFor="settings-sms-key"
            secret={sms.api_key}
            value={value.api_key}
            onChange={(next) => set('api_key', next)}
            error={errors.api_key}
          />

          <SecretRow
            label="API secret"
            htmlFor="settings-sms-secret"
            secret={sms.api_secret}
            value={value.api_secret}
            onChange={(next) => set('api_secret', next)}
            error={errors.api_secret}
          />
        </>
      )}
    </SectionForm>
  )
}
