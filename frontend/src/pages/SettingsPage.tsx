import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { MfaEnrolmentFlow } from '../components/security/MfaEnrolmentFlow'
import { RecoveryCodeList } from '../components/security/RecoveryCodeList'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'

/**
 * Your own account: password, and the second factor.
 *
 * Built because three endpoints had no door. `PATCH /auth/password` has
 * existed since staff administration shipped and nothing ever called it —
 * so an administrator could hand somebody an initial password and that
 * person had no way to take it out of the administrator's hands, which is
 * half a feature and the wrong half. ADR-0008 then added two more orphans:
 * regenerating recovery codes, and knowing whether a factor is even on.
 * ADR-0010 added the last three: turning a factor on **voluntarily**,
 * turning a voluntary one off, and the low-recovery-codes warning.
 *
 * Whether "turn off" appears is decided by `mfa_required` — the server's
 * statement of whether the *role* demands a factor — never inferred from
 * the role slug. A required factor cannot be removed here or anywhere.
 *
 * Deliberately *only* your own account. There is no user parameter here for
 * an administrator to supply, for the same reason `Modules/Administration`
 * offers no password reset for anyone else: an administrator silently
 * changing another person's credentials is the one act an audit trail
 * cannot tell apart from impersonation.
 */
export function SettingsPage() {
  const { user, logout, refreshUser } = useAuth()

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

  const [enrolling, setEnrolling] = useState(false)
  const [enrolled, setEnrolled] = useState(false)

  const [disabling, setDisabling] = useState(false)
  const [disableCode, setDisableCode] = useState('')
  const [removing, setRemoving] = useState(false)
  const [disabled, setDisabled] = useState(false)

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
      // The count and the low flag both changed server-side.
      await refreshUser()
    } catch (failure) {
      setMfaError(apiError(failure, 'Could not generate new recovery codes.').message)
    } finally {
      setRegenerating(false)
    }
  }

  async function handleDisable(event: FormEvent) {
    event.preventDefault()
    setMfaError(null)
    setRemoving(true)

    try {
      // Axios spells a DELETE body as `data` — there is no third argument.
      await apiClient.delete('/auth/mfa', { data: { code: disableCode } })
      await refreshUser()
      setDisabling(false)
      setDisableCode('')
      setDisabled(true)
    } catch (failure) {
      setMfaError(apiError(failure, 'Could not turn off two-factor authentication.').message)
    } finally {
      setRemoving(false)
    }
  }

  const remaining = user?.mfa_recovery_codes_remaining

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
          <dd style={{ margin: 0 }}>{user?.role_label ?? user?.role.replace(/_/g, ' ')}</dd>
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
              htmlFor="settings-current-password"
              error={passwordErrors.current_password}
              required
            >
              <Input
                id="settings-current-password"
                type="password"
                iconLeft="lock"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                revealable
                required
              />
            </FormField>

            <FormField
              label="New password"
              htmlFor="settings-new-password"
              hint="At least 12 characters, and different from your current one."
              error={passwordErrors.password}
              required
            >
              <Input
                id="settings-new-password"
                type="password"
                iconLeft="lock"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                revealable
                required
              />
            </FormField>

            <FormField label="Confirm new password" htmlFor="settings-confirm-password" required>
              <Input
                id="settings-confirm-password"
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
            {enrolled && (
              <Alert tone="success" title="Two-factor authentication is on">
                From now on, signing in asks for a code from your authenticator app.
              </Alert>
            )}
            <p style={{ marginBottom: 'var(--space-4)' }}>
              <Badge tone="success" icon="shield-check">
                On
              </Badge>
            </p>

            {/*
              The server's verdict, not a client-side comparison — ADR-0010
              decision 3 exists because the low-water mark had no reader
              and people learned the count by running out.
            */}
            {user.mfa_recovery_codes_low && recoveryCodes === null && (
              <Alert tone="warning" title="Recovery codes running low">
                {remaining === 0
                  ? 'You have no recovery codes left. If you lose your phone, nobody can restore this account — generate a new set now.'
                  : `Only ${remaining} recovery ${remaining === 1 ? 'code' : 'codes'} left. Generate a new set before you need them.`}
              </Alert>
            )}

            {recoveryCodes === null ? (
              <>
                <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
                  {typeof remaining === 'number'
                    ? `${remaining} recovery ${remaining === 1 ? 'code' : 'codes'} remaining. `
                    : ''}
                  Running low, or think someone else has seen them? Generating a new set immediately
                  invalidates the old one.
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

            {user.mfa_required ? (
              <p
                style={{
                  font: 'var(--type-body-dense)',
                  color: 'var(--text-secondary)',
                  marginTop: 'var(--space-4)',
                }}
              >
                Two-factor authentication is required for your role and cannot be turned off.
              </p>
            ) : disabling ? (
              <form
                onSubmit={handleDisable}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                  marginTop: 'var(--space-4)',
                }}
              >
                {/*
                  Proven with a code even though the session is signed in —
                  same reasoning as the password form above, and the server
                  demands it anyway: a stolen token must not be enough to
                  strip the factor.
                */}
                <FormField
                  label="Enter a 6-digit code — or a recovery code — to turn it off"
                  htmlFor="settings-disable-code"
                  required
                >
                  <Input
                    id="settings-disable-code"
                    iconLeft="shield"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                </FormField>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button type="submit" variant="destructive" disabled={removing}>
                    {removing ? 'Turning off…' : 'Turn off two-factor authentication'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDisabling(false)
                      setDisableCode('')
                    }}
                  >
                    Keep it on
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                variant="ghost"
                iconLeft="shield-off"
                onClick={() => setDisabling(true)}
                style={{ marginTop: 'var(--space-4)' }}
              >
                Turn off…
              </Button>
            )}
          </>
        ) : enrolling ? (
          <MfaEnrolmentFlow
            onDone={() => {
              setEnrolling(false)
              setEnrolled(true)
              void refreshUser()
            }}
          />
        ) : (
          <>
            {disabled && (
              <Alert
                tone="success"
                title="Two-factor authentication is off"
                onDismiss={() => setDisabled(false)}
              >
                You can turn it back on at any time.
              </Alert>
            )}
            <p style={{ marginBottom: 'var(--space-4)' }}>
              <Badge tone="neutral" icon="shield">
                Off
              </Badge>
            </p>
            {/*
              Voluntary since ADR-0010: login challenges anyone with a
              confirmed factor, not just the roles that must hold one. The
              earlier version of this page refused to offer the button
              because enrolling used to produce an authenticator nothing
              ever asked for — that premise is gone.
            */}
            <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
              Optional for your role, and recommended: with it, a stolen password is not enough to
              sign in as you.
            </p>
            <Button
              iconLeft="shield-check"
              onClick={() => setEnrolling(true)}
              style={{ marginTop: 'var(--space-4)' }}
            >
              Turn on two-factor authentication
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
