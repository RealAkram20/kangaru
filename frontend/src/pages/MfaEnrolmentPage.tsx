import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { RecoveryCodeList } from '../components/security/RecoveryCodeList'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'

/**
 * Setting up a second factor (ADR-0008 decision 3).
 *
 * Reached because the user has to be here: a Super Admin or Finance officer
 * who has not enrolled can authenticate and then do **nothing else** —
 * every other endpoint answers 403 `MFA_ENROLMENT_REQUIRED`. Enrolment is
 * forced rather than nagged, because a grace period is a schedule for being
 * non-compliant and the people who ignore it longest are the ones with the
 * most access.
 *
 * Three states, in order: fetch a secret, prove it, keep the recovery
 * codes. The third is not a confirmation screen that can be skipped — it is
 * the only time the codes are ever legible, and the reason it blocks.
 */
interface EnrolmentStart {
  secret: string
  otpauth_uri: string
  qr_svg: string
}

export function MfaEnrolmentPage() {
  const { user, markMfaEnrolled, logout } = useAuth()
  const navigate = useNavigate()

  const [start, setStart] = useState<EnrolmentStart | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const begin = useCallback(() => {
    apiClient
      .post<ApiSuccess<EnrolmentStart>>('/auth/mfa/enrol')
      .then((response) => setStart(response.data.data))
      .catch((failure: unknown) =>
        setError(apiError(failure, 'Could not start two-factor setup.').message),
      )
  }, [])

  useEffect(() => {
    begin()
  }, [begin])

  async function handleConfirm(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const response = await apiClient.post<ApiSuccess<{ recovery_codes: string[] }>>(
        '/auth/mfa/enrol/confirm',
        { code },
      )
      setRecoveryCodes(response.data.data.recovery_codes)
    } catch (failure) {
      setError(apiError(failure, 'That code was not accepted.').message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Third state: the codes, shown once ─────────────────────────────────
  if (recoveryCodes !== null) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-8)' }}>
        <Card title="Save your recovery codes">
          <RecoveryCodeList codes={recoveryCodes} />

          <Button
            size="lg"
            iconRight="arrow-right"
            onClick={() => {
              markMfaEnrolled()
              navigate('/', { replace: true })
            }}
          >
            I have saved them — continue
          </Button>
        </Card>
      </div>
    )
  }

  // ── First and second states: scan, then prove ──────────────────────────
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-8)' }}>
      <Card
        title="Set up two-factor authentication"
        subtitle={`Required for ${user?.role.replace(/_/g, ' ') ?? 'your role'} — this role can issue invoices and change rates.`}
      >
        {error && (
          <Alert tone="error" title="Setup failed" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {start === null ? (
          <p style={{ color: 'var(--text-secondary)' }}>Preparing your setup code…</p>
        ) : (
          <>
            <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
              Scan this with Google Authenticator, 1Password, Authy or any TOTP app.
            </p>

            {/*
              The QR arrives as SVG markup from the server rather than as an
              image URL, so it needs dangerouslySetInnerHTML. It is safe
              here and nowhere near user input: BaconQrCode renders it from
              an otpauth URI the server built out of a generated secret and
              the app name, so no part of the string originates with a
              client. Rendering it as an <img src> would have meant either a
              data: URI or a second authenticated request for a
              single-use secret.
            */}
            <div
              aria-label="Two-factor setup QR code"
              role="img"
              style={{ margin: 'var(--space-4) 0', width: 256, height: 256 }}
              dangerouslySetInnerHTML={{ __html: start.qr_svg }}
            />

            <details style={{ marginBottom: 'var(--space-4)' }}>
              <summary style={{ cursor: 'pointer', font: 'var(--type-body-dense)' }}>
                Can&rsquo;t scan it?
              </summary>
              <p
                style={{
                  fontFamily: 'var(--font-mono, monospace)',
                  wordBreak: 'break-all',
                  marginTop: 'var(--space-2)',
                }}
              >
                {start.secret}
              </p>
            </details>

            <form
              onSubmit={handleConfirm}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
            >
              <FormField label="Enter the 6-digit code from the app" required>
                <Input
                  iconLeft="shield-check"
                  size="lg"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </FormField>
              <Button size="lg" type="submit" iconRight="arrow-right" disabled={submitting}>
                {submitting ? 'Checking…' : 'Turn on two-factor authentication'}
              </Button>
            </form>
          </>
        )}

        {/*
          Signing out has to stay reachable. Somebody who does not have
          their phone to hand cannot enrol, and trapping them in an
          application they can neither use nor leave is its own bug — the
          server keeps `auth.logout` on the allowlist for the same reason.
        */}
        <Button
          variant="ghost"
          onClick={() => void logout()}
          style={{ marginTop: 'var(--space-4)' }}
        >
          Sign out
        </Button>
      </Card>
    </div>
  )
}
