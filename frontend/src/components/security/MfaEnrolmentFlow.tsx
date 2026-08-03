import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import { Alert } from '../feedback/Alert'
import { Button } from '../core/Button'
import { FormField } from '../forms/FormField'
import { Input } from '../forms/Input'
import { RecoveryCodeList } from './RecoveryCodeList'

/**
 * The three-state enrolment sequence — fetch a secret, prove it, keep the
 * recovery codes — shared by the two places a factor gets set up: the
 * forced full-page flow (ADR-0008 decision 3) and the voluntary path on
 * the Settings page (ADR-0010 decision 1). One component, because the QR
 * rendering, the can't-scan fallback and the codes-shown-once rule are
 * exactly the things that must not drift between the two.
 *
 * The third state is not a confirmation screen that can be skipped: the
 * codes are legible this once only, and `onDone` fires when the user says
 * they have them, never before.
 */
interface EnrolmentStart {
  secret: string
  otpauth_uri: string
  qr_svg: string
}

export function MfaEnrolmentFlow({
  confirmLabel = 'Turn on two-factor authentication',
  onDone,
}: {
  /** The submit button's text — the forced flow and Settings word it the same today, but the label belongs to the caller. */
  confirmLabel?: string
  /** Called once the user confirms they have saved their recovery codes. */
  onDone: () => void
}) {
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
      <>
        <RecoveryCodeList codes={recoveryCodes} />
        <Button size="lg" iconRight="arrow-right" onClick={onDone}>
          I have saved them — continue
        </Button>
      </>
    )
  }

  // ── First and second states: scan, then prove ──────────────────────────
  return (
    <>
      {error && (
        <Alert tone="error" title="Two-factor setup" onDismiss={() => setError(null)}>
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
            image URL, so it needs dangerouslySetInnerHTML. It is safe here
            and nowhere near user input: BaconQrCode renders it from an
            otpauth URI the server built out of a generated secret and the
            app name, so no part of the string originates with a client.
            Rendering it as an <img src> would have meant either a data: URI
            or a second authenticated request for a single-use secret.
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
            <FormField
              label="Enter the 6-digit code from the app"
              htmlFor="mfa-enrolment-code"
              required
            >
              <Input
                id="mfa-enrolment-code"
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
              {submitting ? 'Checking…' : confirmLabel}
            </Button>
          </form>
        </>
      )}
    </>
  )
}
