import axios from 'axios'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { MIN_PASSWORD_LENGTH } from '../auth/passwordStrength'
import { Logo } from '../components/brand/Logo'
import { Button } from '../components/core/Button'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { PasswordMeter } from '../components/forms/PasswordMeter'
import { apiClient } from '../lib/apiClient'
import { useIsCompact } from '../lib/useMediaQuery'

/**
 * Forgot-password by emailed code (ADR-0028 §2), for the console.
 *
 * The backend flow and the driver app's screen both predate this page; the
 * console's login simply never grew the link — which left an operator who
 * forgot their password with no way in short of somebody with a shell. The
 * owner hit exactly that on 24 August 2026.
 *
 * Two steps on one page, mirroring `LoginPage`'s challenge step: the email
 * never has to survive a route change, and neither the code nor the new
 * password ever appears in a URL.
 *
 * What this page deliberately does not do:
 *
 * - **Say whether the email exists.** The server answers an identical 202
 *   either way (the same oracle-refusal as sign-in), and the sentence shown
 *   is the server's own, written for that ambiguity.
 * - **Sign the user in.** A reset proves control of an inbox, not a second
 *   factor; the roles ADR-0008 gates still owe their code at sign-in, so
 *   success lands on `/login` like `AcceptInvitePage` does.
 */

/**
 * The server's message wherever it has one — it distinguishes a spent code
 * from a disabled method from a throttle, and each sends the reader
 * somewhere different.
 */
function messageFor(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Something went wrong. Please try again.'
  }

  if (!error.response) {
    const target = import.meta.env.VITE_API_BASE_URL ?? 'the API'
    return `Cannot reach the KangaruRide server at ${target}. Check that the API is running, then try again.`
  }

  if (error.response.status === 429) {
    return 'Too many attempts. Wait a minute and try again.'
  }

  const message = (error.response.data as { message?: string } | undefined)?.message
  return message ?? 'Something went wrong. Please try again.'
}

export function ForgotPasswordPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const compact = useIsCompact()

  // Typed on the login page before the reader clicked through; asking again
  // would be the form forgetting what it was just told.
  const [email, setEmail] = useState(
    (location.state as { email?: string } | null)?.email ?? '',
  )
  const [step, setStep] = useState<'request' | 'reset'>('request')
  /** The 202's own sentence — the one honest thing to say about an inbox. */
  const [notice, setNotice] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) {
    return <Navigate to="/" replace />
  }

  async function requestCode(event?: FormEvent) {
    event?.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await apiClient.post('/auth/password/forgot', { email })
      setNotice((response.data as { message?: string }).message ?? null)
      setStep('reset')
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault()

    // Told before the round trip, not after. The server still decides.
    if (password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      await apiClient.post('/auth/password/reset', {
        email,
        code,
        password,
        password_confirmation: confirmation,
      })
      navigate('/login', { replace: true })
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : '1.1fr 1fr',
        gridTemplateRows: compact ? 'auto 1fr' : undefined,
      }}
    >
      <div
        style={{
          background: 'var(--surface-chrome)',
          padding: compact
            ? 'var(--space-6) var(--space-5)'
            : 'var(--space-16) var(--space-12)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: compact ? 'var(--space-4)' : undefined,
        }}
      >
        <Logo variant="horizontal-navy" height={compact ? 30 : 38} />
        {!compact && (
          <h1
            style={{
              font: 'var(--type-page-title)',
              fontSize: 'var(--text-4xl)',
              color: 'var(--text-on-chrome)',
              maxWidth: 460,
            }}
          >
            Every trip recorded. Every invoice reproducible.
          </h1>
        )}
        {!compact && (
          <p style={{ font: 'var(--type-caption)', color: 'var(--text-on-chrome-secondary)' }}>
            Shanitah General Enterprises Ltd · Kampala, Uganda
          </p>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: compact ? 'flex-start' : 'center',
          justifyContent: 'center',
          padding: compact ? 'var(--space-8) var(--space-5)' : 'var(--space-12)',
        }}
      >
        {step === 'request' ? (
          <form onSubmit={requestCode} style={{ width: '100%', maxWidth: 360 }}>
            <h2
              style={{
                font: 'var(--type-section-title)',
                fontSize: 'var(--text-2xl)',
                color: 'var(--text-heading)',
              }}
            >
              Reset your password
            </h2>
            <p
              style={{
                font: 'var(--type-body-dense)',
                color: 'var(--text-secondary)',
                marginTop: 6,
                marginBottom: 'var(--space-6)',
              }}
            >
              We&rsquo;ll email you a 6-digit code.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {error && (
                <p style={{ font: 'var(--type-body-dense)', color: 'var(--kr-error)' }} role="alert">
                  {error}
                </p>
              )}
              <FormField label="Work email" htmlFor="forgot-email" required>
                <Input
                  id="forgot-email"
                  iconLeft="mail"
                  type="email"
                  placeholder="you@company.co.ug"
                  size="lg"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus={email === ''}
                  required
                />
              </FormField>
              <Button size="lg" fullWidth iconRight="arrow-right" type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Email me a code'}
              </Button>
              <Button
                size="lg"
                fullWidth
                variant="ghost"
                type="button"
                onClick={() => navigate('/login')}
              >
                Back to sign in
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitReset} style={{ width: '100%', maxWidth: 360 }}>
            <h2
              style={{
                font: 'var(--type-section-title)',
                fontSize: 'var(--text-2xl)',
                color: 'var(--text-heading)',
              }}
            >
              Enter the code
            </h2>
            <p
              style={{
                font: 'var(--type-body-dense)',
                color: 'var(--text-secondary)',
                marginTop: 6,
                marginBottom: 'var(--space-6)',
              }}
              role="status"
            >
              {notice ?? `Sent to ${email}.`}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {error && (
                <p style={{ font: 'var(--type-body-dense)', color: 'var(--kr-error)' }} role="alert">
                  {error}
                </p>
              )}
              <FormField label="6-digit code" htmlFor="forgot-code" required>
                <Input
                  id="forgot-code"
                  iconLeft="shield-check"
                  size="lg"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  // Same box rules as the MFA step: numeric keypad without a
                  // number input's leading-zero stripping.
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  required
                />
              </FormField>
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                <FormField label="New password" htmlFor="forgot-password" required>
                  <Input
                    id="forgot-password"
                    type="password"
                    iconLeft="lock"
                    size="lg"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    revealable
                    required
                  />
                </FormField>
                <PasswordMeter password={password} />
              </div>
              <FormField label="Confirm password" htmlFor="forgot-confirm" required>
                <Input
                  id="forgot-confirm"
                  type="password"
                  iconLeft="lock"
                  size="lg"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  revealable
                  required
                />
              </FormField>
              <Button size="lg" fullWidth iconRight="arrow-right" type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Set password'}
              </Button>
              <Button
                size="lg"
                fullWidth
                variant="ghost"
                type="button"
                disabled={submitting}
                onClick={() => void requestCode()}
              >
                Send a new code
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
