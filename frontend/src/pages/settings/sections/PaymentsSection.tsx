import { Input } from '../../../components/forms/Input'
import { Row, SecretRow, SectionForm } from '../kit'
import { orNull, useSectionState, withSecrets } from '../state'
import type { SectionProps } from '../types'

export function PaymentsSection({ settings, onSaved, section }: SectionProps) {
  const payments = settings.payments
  const state = useSectionState({
    mtn_momo_api_user: payments.mtn_momo_api_user ?? '',
    mtn_momo_api_key: '',
    airtel_money_client_id: payments.airtel_money_client_id ?? '',
    airtel_money_client_secret: '',
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      secretKeys={['mtn_momo_api_key', 'airtel_money_client_secret']}
      payload={() =>
        withSecrets(
          {
            mtn_momo_api_user: orNull(value.mtn_momo_api_user),
            airtel_money_client_id: orNull(value.airtel_money_client_id),
          },
          {
            mtn_momo_api_key: value.mtn_momo_api_key,
            airtel_money_client_secret: value.airtel_money_client_secret,
          },
        )
      }
    >
      {(errors) => (
        <>
          {/* The gateway's name stays in each label rather than moving to a
              band above the rows. Four rows do not need chapter headings, and
              a control announced only as "API user" leaves a screen reader
              user with two of them and no way to tell which is MTN's. */}
          <Row
            label="MTN MoMo API user"
            htmlFor="settings-mtn-user"
            error={errors.mtn_momo_api_user}
            control={380}
          >
            <Input
              id="settings-mtn-user"
              autoComplete="off"
              value={value.mtn_momo_api_user}
              onChange={(event) => set('mtn_momo_api_user', event.target.value)}
            />
          </Row>

          <SecretRow
            label="MTN MoMo API key"
            htmlFor="settings-mtn-key"
            secret={payments.mtn_momo_api_key}
            value={value.mtn_momo_api_key}
            onChange={(next) => set('mtn_momo_api_key', next)}
            error={errors.mtn_momo_api_key}
          />

          <Row
            label="Airtel Money client ID"
            htmlFor="settings-airtel-id"
            error={errors.airtel_money_client_id}
            control={380}
          >
            <Input
              id="settings-airtel-id"
              autoComplete="off"
              value={value.airtel_money_client_id}
              onChange={(event) => set('airtel_money_client_id', event.target.value)}
            />
          </Row>

          <SecretRow
            label="Airtel Money client secret"
            htmlFor="settings-airtel-secret"
            secret={payments.airtel_money_client_secret}
            value={value.airtel_money_client_secret}
            onChange={(next) => set('airtel_money_client_secret', next)}
            error={errors.airtel_money_client_secret}
          />
        </>
      )}
    </SectionForm>
  )
}
