import axios from 'axios'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Logo } from '../components/brand/Logo'
import { Button } from '../components/core/Button'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { fetchPublicSettings } from '../lib/publicSettings'
import { useIsCompact } from '../lib/useMediaQuery'

/**
 * Two steps since ADR-0008, for the roles that can move money.
 *
 * The comment that used to live here said the MFA step was "dropped since
 * the backend has no MFA endpoint in this pass" — correct at the time, and
 * the endpoint now exists. A Super Admin or Finance officer who enters a
 * correct password gets a `202` and no token at all: decision 2 refuses to
 * mint credential material before the factor is proved, so there is nothing
 * to store until the code arrives.
 *
 * Everyone else is unchanged. PROJECT.md puts MFA for other roles out of
 * Phase 1, and the Bank's six acceptance criteria are demonstrated through
 * a Corporate Admin, which stays a single-step sign-in.
 */
/**
 * AGENTS.md Error Handling: "Every error message explains what happened,
 * why (when appropriate), and what the user should do next."
 *
 * This used to be a bare `catch` that reported every failure as "the email
 * or password you entered is incorrect" — so an unreachable API and a
 * throttled retry both read as a typo, and the one thing the user could do
 * about it (start the server, wait a minute) was the one thing the message
 * never said.
 */
function signInErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Something went wrong signing you in. Please try again.'
  }

  // No response at all: the request never reached a server. Almost always
  // the API not running, or the wrong VITE_API_BASE_URL.
  if (!error.response) {
    const target = import.meta.env.VITE_API_BASE_URL ?? 'the API'
    return `Cannot reach the KangaruRide server at ${target}. Check that the API is running, then try again.`
  }

  const { status, data } = error.response
  const code = (data as { code?: string } | undefined)?.code

  // The login route is throttled to 5 attempts a minute. Without this, a
  // locked-out user keeps retrying a password that is actually correct.
  if (status === 429) {
    return 'Too many sign-in attempts. Please wait a minute and try again.'
  }

  if (status === 401 || code === 'INVALID_CREDENTIALS') {
    return 'The email or password you entered is incorrect.'
  }

  if (status >= 500) {
    return 'The server ran into a problem signing you in. Please try again, and contact support if it continues.'
  }

  // Everything else (422 validation, anything new): the server's own
  // message is written for the user and is more specific than ours.
  const message = (data as { message?: string } | undefined)?.message
  return message ?? 'Something went wrong signing you in. Please try again.'
}

export function LoginPage() {
  const { user, login, verifyMfa } = useAuth()
  const compact = useIsCompact()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /**
   * Set when the password was accepted and a factor is still owed. Holding
   * it here rather than in a route keeps it out of the URL and out of
   * browser history — it is single-use credential material with a
   * five-minute life, and a challenge in an address bar is a challenge in a
   * shoulder-surfed screenshot.
   */
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  /**
   * ADR-0028 §4: the client reads the flag before showing the flow, so a
   * door the owner switched off never renders. False until the server says
   * otherwise — the same fail-closed rule as the driver app.
   */
  const [resetEnabled, setResetEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchPublicSettings().then((settings) => {
      if (!cancelled) setResetEnabled(settings.auth.password_reset_enabled)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (user) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const outcome = await login(email, password)

      if (outcome.status === 'mfa-required') {
        setChallengeId(outcome.challengeId)
        // Cleared as soon as it is spent. Leaving a correct password in a
        // controlled input for the length of the second step is the kind of
        // thing a screen recording picks up.
        setPassword('')
      }
    } catch (caught) {
      setError(signInErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault()
    if (challengeId === null) return

    setError(null)
    setSubmitting(true)
    try {
      await verifyMfa(challengeId, code)
    } catch (caught) {
      setError(signInErrorMessage(caught))

      // A challenge is single-use, and the server spends it whether or not
      // the code was right — otherwise its five-minute window would be an
      // unlimited guessing budget against six digits. So a failure here is
      // terminal for this attempt, and the honest response is to send the
      // user back to the password rather than let them retype a code
      // against a ticket that is already void.
      setChallengeId(null)
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    /*
      Two columns on a desktop, one on a phone.

      It was `1.1fr 1fr` at every width, which meant that at 390px the two
      columns and their `--space-12` padding needed 725px: the marketing panel
      filled the screen and the form — Sign in included — sat off-screen to the
      right. Nobody could sign into either console from a phone, which is the
      worst place for a layout bug to be, since it is the door to everything.
    */
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
          // A band above the form on a phone rather than half the screen: the
          // pitch is for someone deciding whether to buy, and this person has
          // an account and wants to get in.
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
        {/* The headline and the footer are the parts that do not survive a
            phone: keeping them would push the password field below the fold
            on a 667px screen, behind the keyboard. */}
        {!compact && (
          <div>
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
            <p
              style={{
                font: 'var(--type-body)',
                color: 'var(--text-on-chrome-secondary)',
                marginTop: 'var(--space-4)',
                maxWidth: 460,
              }}
            >
              Transport management for corporate fleets: dispatch, GPS tracking, odometer capture,
              rate-card billing and enterprise reporting.
            </p>
          </div>
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
        {challengeId === null ? (
          <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 360 }}>
            <h2
              style={{
                font: 'var(--type-section-title)',
                fontSize: 'var(--text-2xl)',
                color: 'var(--text-heading)',
              }}
            >
              Sign in
            </h2>
            <p
              style={{
                font: 'var(--type-body-dense)',
                color: 'var(--text-secondary)',
                marginTop: 6,
                marginBottom: 'var(--space-6)',
              }}
            >
              Use your organisation email.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {error && (
                <p
                  style={{ font: 'var(--type-body-dense)', color: 'var(--kr-error)' }}
                  role="alert"
                >
                  {error}
                </p>
              )}
              <FormField label="Work email" htmlFor="login-email" required>
                <Input
                  id="login-email"
                  iconLeft="mail"
                  type="email"
                  placeholder="you@company.co.ug"
                  size="lg"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Password" htmlFor="login-password" required>
                <Input
                  id="login-password"
                  type="password"
                  iconLeft="lock"
                  placeholder="••••••••"
                  size="lg"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  revealable
                  required
                />
              </FormField>
              {resetEnabled && (
                <Link
                  to="/forgot-password"
                  // The typed email rides along so the next page does not ask
                  // for what this one already knows.
                  state={{ email }}
                  style={{
                    font: 'var(--type-body-dense)',
                    color: 'var(--text-link)',
                    textDecoration: 'none',
                    justifySelf: 'end',
                    alignSelf: 'flex-end',
                  }}
                >
                  Forgot password?
                </Link>
              )}
              <Button
                size="lg"
                fullWidth
                iconRight="arrow-right"
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerify} style={{ width: '100%', maxWidth: 360 }}>
            <h2
              style={{
                font: 'var(--type-section-title)',
                fontSize: 'var(--text-2xl)',
                color: 'var(--text-heading)',
              }}
            >
              Two-factor authentication
            </h2>
            <p
              style={{
                font: 'var(--type-body-dense)',
                color: 'var(--text-secondary)',
                marginTop: 6,
                marginBottom: 'var(--space-6)',
              }}
            >
              Your role can issue invoices and change rates, so it needs a second factor. Enter the
              6-digit code from your authenticator app, or one of your recovery codes.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {error && (
                <p
                  style={{ font: 'var(--type-body-dense)', color: 'var(--kr-error)' }}
                  role="alert"
                >
                  {error}
                </p>
              )}
              <FormField label="Authentication code" htmlFor="login-mfa-code" required>
                <Input
                  id="login-mfa-code"
                  iconLeft="shield-check"
                  size="lg"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  // Not `type="number"`: a recovery code is accepted in the
                  // same box, and a numeric input would refuse it while
                  // also stripping the leading zero off a TOTP code.
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                />
              </FormField>
              <Button
                size="lg"
                fullWidth
                iconRight="arrow-right"
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Verifying…' : 'Verify and sign in'}
              </Button>
              <Button
                size="lg"
                fullWidth
                variant="ghost"
                type="button"
                onClick={() => {
                  setChallengeId(null)
                  setCode('')
                  setError(null)
                }}
              >
                Back to sign in
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
