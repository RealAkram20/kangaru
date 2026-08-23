import axios from 'axios'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Logo } from '../components/brand/Logo'
import { Button } from '../components/core/Button'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { apiClient } from '../lib/apiClient'
import { useIsCompact } from '../lib/useMediaQuery'

/**
 * Setting a password on an account somebody else created (mail plan M2).
 *
 * ## Why this page has to exist
 *
 * `ClientOnboardingService` and `OperatorService` both create an active
 * account with a random password nobody is told. `StoreUserRequest` named the
 * missing half exactly: *"An invite flow needs a signed, expiring token and a
 * public accept-invite page, neither of which exists."* This is the page.
 * Without it, a corporate client admin and a fleet owner are accounts nobody
 * can sign into.
 *
 * ## Why it shows the account before asking for anything
 *
 * The reader arrived from an email asking them to set a password on a service
 * they may never have used. That is the exact shape of a phishing attempt, and
 * a bare password form gives them nothing to check it against. Showing whose
 * account this is, and the address it signs in as, is what lets them recognise
 * it as theirs.
 *
 * Those two fields are not a leak: they belong to the holder of a 48-character
 * single-use token, who is the person they describe.
 *
 * ## Why it does not sign anybody in
 *
 * The backend answers a message, not a session, so that a Super Admin or a
 * Finance officer cannot skip the second factor ADR-0008 requires of them, and
 * those are the roles most likely to be invited. The redirect to sign-in also
 * makes the reader use the password they just chose while they are still at
 * the keyboard to fix a typo.
 */

type Invitation = {
  name: string
  email: string
  expires_at: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; invitation: Invitation }
  | { status: 'unusable'; message: string }

/**
 * The server's own message, preferred over anything written here.
 *
 * It distinguishes three cases this page cannot: an unknown token, one that
 * has already been used, and one that lapsed. They send the reader to three
 * different places, so collapsing them into a house sentence would be a
 * downgrade.
 */
function messageFor(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Something went wrong. Try the link again.'
  }

  if (!error.response) {
    const target = import.meta.env.VITE_API_BASE_URL ?? 'the API'
    return `Cannot reach the KangaruRide server at ${target}. Check that the API is running, then try again.`
  }

  if (error.response.status === 429) {
    return 'Too many attempts. Wait a minute and try again.'
  }

  const message = (error.response.data as { message?: string } | undefined)?.message
  return message ?? 'Something went wrong. Try the link again.'
}

export function AcceptInvitePage() {
  const { token = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const compact = useIsCompact()

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get(`/invitations/${encodeURIComponent(token)}`)
      .then((response) => {
        if (cancelled) return
        setState({ status: 'ready', invitation: response.data.data as Invitation })
      })
      .catch((caught) => {
        if (cancelled) return
        setState({ status: 'unusable', message: messageFor(caught) })
      })

    return () => {
      cancelled = true
    }
  }, [token])

  // Somebody already signed in does not need an invitation, and accepting one
  // while holding a session would close that session out from under them.
  if (user) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    // Checked here as well as on the server so the reader is told before a
    // round trip, not after. The server still decides.
    if (password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      await apiClient.post(`/invitations/${encodeURIComponent(token)}/accept`, {
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
        <div style={{ width: '100%', maxWidth: 360 }}>
          {state.status === 'loading' && (
            <p style={{ font: 'var(--type-body)', color: 'var(--text-secondary)' }}>Checking your link…</p>
          )}

          {state.status === 'unusable' && (
            <>
              <h2
                style={{
                  font: 'var(--type-section-title)',
                  fontSize: 'var(--text-2xl)',
                  color: 'var(--text-heading)',
                }}
              >
                This link does not work
              </h2>
              <p
                style={{
                  font: 'var(--type-body-dense)',
                  color: 'var(--text-secondary)',
                  marginTop: 6,
                  marginBottom: 'var(--space-6)',
                }}
                role="alert"
              >
                {state.message}
              </p>
              <Button size="lg" fullWidth variant="secondary" onClick={() => navigate('/login')}>
                Go to sign in
              </Button>
            </>
          )}

          {state.status === 'ready' && (
            <form onSubmit={handleSubmit}>
              <h2
                style={{
                  font: 'var(--type-section-title)',
                  fontSize: 'var(--text-2xl)',
                  color: 'var(--text-heading)',
                }}
              >
                Choose a password
              </h2>
              {/*
                The account, so the reader can recognise it as theirs. This is
                the one thing on the page that is not a control, and it earns
                its place: without it this is a password form from a stranger.
              */}
              <p
                style={{
                  font: 'var(--type-body-dense)',
                  color: 'var(--text-secondary)',
                  marginTop: 6,
                  marginBottom: 'var(--space-6)',
                }}
              >
                {state.invitation.name} · {state.invitation.email}
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
                <FormField label="Password" htmlFor="invite-password" required hint="At least 8 characters.">
                  <Input
                    id="invite-password"
                    type="password"
                    iconLeft="lock"
                    size="lg"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    revealable
                    required
                  />
                </FormField>
                <FormField label="Confirm password" htmlFor="invite-confirm" required>
                  <Input
                    id="invite-confirm"
                    type="password"
                    iconLeft="lock"
                    size="lg"
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    revealable
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
                  {submitting ? 'Saving…' : 'Set password'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
