import { Input } from '../../../components/forms/Input'
import { Switch } from '../../../components/forms/Switch'
import { Group, Row, SecretRow, SectionForm } from '../kit'
import { orNull, useSectionState, withSecrets } from '../state'
import type { SectionProps } from '../types'

/**
 * Which ways into the Driver App are on (ADR-0028).
 *
 * The three switches are what the app's welcome screen renders from —
 * fail-closed, so turning one off here removes the button from every phone
 * within a settings-cache refresh, no release involved. The credential fields
 * exist because the switches are worthless without them: the server refuses
 * tokens minted for anybody else's app.
 */
export function AuthSection({ settings, onSaved, section }: SectionProps) {
  const auth = settings.auth
  const mailEnabled = settings.mail.enabled
  const state = useSectionState({
    password_reset_enabled: auth.password_reset_enabled,
    google_enabled: auth.google_enabled,
    facebook_enabled: auth.facebook_enabled,
    google_client_ids: auth.google_client_ids ?? '',
    facebook_app_id: auth.facebook_app_id ?? '',
    facebook_app_secret: '',
    mfa_enforced: auth.mfa_enforced,
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      secretKeys={['facebook_app_secret']}
      payload={() =>
        withSecrets(
          {
            password_reset_enabled: value.password_reset_enabled,
            google_enabled: value.google_enabled,
            facebook_enabled: value.facebook_enabled,
            google_client_ids: orNull(value.google_client_ids),
            facebook_app_id: orNull(value.facebook_app_id),
            mfa_enforced: value.mfa_enforced,
          },
          { facebook_app_secret: value.facebook_app_secret },
        )
      }
    >
      {(errors) => (
        <>
          <Row
            label="Require a second factor"
            htmlFor="settings-auth-mfa"
            hint={
              value.mfa_enforced
                ? 'Roles marked on the Roles page ask for a code at sign-in.'
                : 'Nobody is asked for a code. Existing factors still work and no role setting is changed.'
            }
          >
            <Switch
              id="settings-auth-mfa"
              checked={value.mfa_enforced}
              onChange={(event) => set('mfa_enforced', event.target.checked)}
            />
          </Row>

          <Row
            label="Password reset by emailed code"
            htmlFor="settings-auth-reset"
            hint={
              mailEnabled
                ? 'A six-digit code, valid for fifteen minutes.'
                : 'Needs Email configured and switched on first. Saved but inert until then.'
            }
          >
            <Switch
              id="settings-auth-reset"
              checked={value.password_reset_enabled}
              onChange={(event) => set('password_reset_enabled', event.target.checked)}
            />
          </Row>

          <Group>Google</Group>

          <Row
            label="Continue with Google"
            htmlFor="settings-auth-google"
            hint="Existing drivers only. A stranger goes to the application queue."
          >
            <Switch
              id="settings-auth-google"
              checked={value.google_enabled}
              onChange={(event) => set('google_enabled', event.target.checked)}
            />
          </Row>

          <Row
            label="Google client IDs"
            htmlFor="settings-auth-google-ids"
            hint="From Google Cloud Console — Android, iOS and web."
            error={errors.google_client_ids}
          >
            <Input
              id="settings-auth-google-ids"
              placeholder="1234-abc.apps.googleusercontent.com, 1234-def.apps.googleusercontent.com"
              autoComplete="off"
              value={value.google_client_ids}
              onChange={(event) => set('google_client_ids', event.target.value)}
            />
          </Row>

          <Group>Facebook</Group>

          <Row label="Continue with Facebook" htmlFor="settings-auth-facebook">
            <Switch
              id="settings-auth-facebook"
              checked={value.facebook_enabled}
              onChange={(event) => set('facebook_enabled', event.target.checked)}
            />
          </Row>

          <Row
            label="Facebook app ID"
            htmlFor="settings-auth-fb-id"
            hint="From Meta for Developers."
            error={errors.facebook_app_id}
            control={380}
          >
            <Input
              id="settings-auth-fb-id"
              autoComplete="off"
              value={value.facebook_app_id}
              onChange={(event) => set('facebook_app_id', event.target.value)}
            />
          </Row>

          <SecretRow
            label="Facebook app secret"
            htmlFor="settings-auth-fb-secret"
            secret={auth.facebook_app_secret}
            value={value.facebook_app_secret}
            onChange={(next) => set('facebook_app_secret', next)}
            error={errors.facebook_app_secret}
          />
        </>
      )}
    </SectionForm>
  )
}
