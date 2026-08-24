import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { PasswordMeter } from '../components/forms/PasswordMeter'
import { RecoveryCodeList } from '../components/security/RecoveryCodeList'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'

/**
 * Your own account: who you are signed in as, your password, and the second
 * factor if you have one. Reached from the profile widget in the sidebar and
 * from the topbar avatar menu — the two places an account already has a face.
 *
 * It was called "Settings" and sat one row away from System settings in the
 * same sidebar, which is the whole reason it is now called Profile: two
 * entries named Settings, one of them meaning "your password" and the other
 * "the platform's name and SMTP credentials", is a name collision the user
 * has to open a page to resolve.
 *
 * Built because three endpoints had no door. `PATCH /auth/password` has
 * existed since staff administration shipped and nothing ever called it —
 * so an administrator could hand somebody an initial password and that
 * person had no way to take it out of the administrator's hands, which is
 * half a feature and the wrong half. ADR-0008 then added two more orphans:
 * regenerating recovery codes, and knowing whether a factor is even on.
 *
 * Deliberately *only* your own account. There is no user parameter here for
 * an administrator to supply, for the same reason `Modules/Administration`
 * offers no password reset for anyone else: an administrator silently
 * changing another person's credentials is the one act an audit trail
 * cannot tell apart from impersonation.
 */
export function ProfilePage() {
  const { user, logout } = useAuth()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({})
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [mfaError, setMfaError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  async function handlePasswordChange(event: FormEvent) {
    event.preventDefault()
    setPasswordError(null)
    setPasswordErrors({})
    setSavingPassword(true)

    try {
      await apiClient.patch('/auth/password', {
        current_password: current,
        password: next,
        password_confirmation: confirmation,
      })

      // Every token is revoked by this call, including the one that made
      // it — a password change usually follows "I think someone else has
      // this", and leaving any session alive would defeat it.
      //
      // So the form is replaced with a sign-out rather than left looking
      // usable. The next request on this token would 401 and bounce the
      // user to /login with no explanation; saying it plainly here is the
      // difference between a considered rule and an app that logged you
      // out for no reason.
      setChanged(true)
      setCurrent('')
      setNext('')
      setConfirmation('')
    } catch (failure) {
      const error = apiError(failure, 'Could not change your password.')
      setPasswordErrors(fieldErrors(error))
      setPasswordError(error.message)
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleRegenerate() {
    setMfaError(null)
    setRegenerating(true)

    try {
      const response = await apiClient.post<ApiSuccess<{ recovery_codes: string[] }>>(
        '/auth/mfa/recovery-codes',
      )
      setRecoveryCodes(response.data.data.recovery_codes)
    } catch (failure) {
      setMfaError(apiError(failure, 'Could not generate new recovery codes.').message)
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 640 }}>
      <Card title="Your account" subtitle={user?.email}>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 'var(--space-2) var(--space-4)',
            margin: 0,
          }}
        >
          <dt style={{ color: 'var(--text-secondary)' }}>Name</dt>
          <dd style={{ margin: 0 }}>{user?.name}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Role</dt>
          <dd style={{ margin: 0 }}>{user?.role.replace(/_/g, ' ')}</dd>
        </dl>
        <p
          style={{
            font: 'var(--type-body-dense)',
            color: 'var(--text-secondary)',
            marginTop: 'var(--space-4)',
          }}
        >
          Your name, email and role are set by an administrator. Ask them if any of it is wrong.
        </p>
      </Card>

      <Card title="Password">
        {changed ? (
          <>
            <Alert tone="success" title="Password changed">
              You have been signed out on every device, including this one. Sign in again with your
              new password.
            </Alert>
            <Button
              size="lg"
              iconRight="arrow-right"
              onClick={() => void logout()}
              style={{ marginTop: 'var(--space-4)' }}
            >
              Sign in again
            </Button>
          </>
        ) : (
          <form
            onSubmit={handlePasswordChange}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {passwordError && Object.keys(passwordErrors).length === 0 && (
              <Alert tone="error" title="Password" onDismiss={() => setPasswordError(null)}>
                {passwordError}
              </Alert>
            )}

            {/*
              The current password is asked for even though the caller is
              already signed in. A bearer token proves the request came from
              a signed-in session, not that the person holding it owns the
              account — an unattended laptop is enough.
            */}
            <FormField
              label="Current password"
              htmlFor="profile-current-password"
              error={passwordErrors.current_password}
              required
            >
              <Input
                id="profile-current-password"
                type="password"
                iconLeft="lock"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                revealable
                required
              />
            </FormField>

            {/*
              The hint said "At least 12 characters" for a door that accepted
              eight, and now accepts six — an overstatement is the same class
              of bug as an understatement, and it survived because the number
              was written out here rather than read from anywhere. What is left
              of it is the half the meter cannot say: `different:current_password`
              is a rule, not a strength, so it stays as the field's hint while
              the floor moves into the checklist below.
            */}
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <FormField
                label="New password"
                htmlFor="profile-new-password"
                hint="Different from your current one."
                error={passwordErrors.password}
                required
              >
                <Input
                  id="profile-new-password"
                  type="password"
                  iconLeft="lock"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  revealable
                  required
                />
              </FormField>

              <PasswordMeter password={next} />
            </div>

            <FormField label="Confirm new password" htmlFor="profile-confirm-password" required>
              <Input
                id="profile-confirm-password"
                type="password"
                iconLeft="lock"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                revealable
                required
              />
            </FormField>

            <div>
              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card
        title="Two-factor authentication"
        subtitle="An authenticator app code, in addition to your password."
      >
        {mfaError && (
          <Alert tone="error" title="Two-factor authentication" onDismiss={() => setMfaError(null)}>
            {mfaError}
          </Alert>
        )}

        {user?.mfa_enabled ? (
          <>
            <p style={{ marginBottom: 'var(--space-4)' }}>
              <Badge tone="success" icon="shield-check">
                On
              </Badge>
            </p>

            {recoveryCodes === null ? (
              <>
                <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
                  Running low on recovery codes, or think someone else has seen them? Generating a
                  new set immediately invalidates the old one.
                </p>
                <Button
                  variant="secondary"
                  iconLeft="rotate-ccw"
                  onClick={() => void handleRegenerate()}
                  disabled={regenerating}
                  style={{ marginTop: 'var(--space-4)' }}
                >
                  {regenerating ? 'Generating…' : 'Generate new recovery codes'}
                </Button>
              </>
            ) : (
              <RecoveryCodeList codes={recoveryCodes} />
            )}
          </>
        ) : (
          <>
            <p style={{ marginBottom: 'var(--space-4)' }}>
              <Badge tone="neutral" icon="shield">
                Off
              </Badge>
            </p>
            {/*
              No "turn it on" button, and this is a real limitation rather
              than an omission.

              `POST /auth/mfa/enrol` would accept the request — it is gated
              on being signed in, not on the role. But `AuthService::login`
              only issues a challenge when the role *requires* a factor, so
              a user in an unprivileged role who enrolled would end up with
              an authenticator nothing ever asks them for. Offering the
              button would be shipping a control that does nothing.

              PROJECT.md puts MFA for other roles out of Phase 1, so the
              honest state is to say so rather than to half-open it.
            */}
            <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
              Two-factor authentication is required for the Super Admin and Finance roles, which can
              issue invoices and change rates. It is not yet offered for other roles.
            </p>
          </>
        )}
      </Card>
    </div>
  )
}
