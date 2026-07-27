import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Logo } from '../components/brand/Logo'
import { Button } from '../components/core/Button'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'

/**
 * Simplified from `ui_kits/platform/LoginScreen.jsx`: the MFA step and its
 * Badge/Alert/Checkbox usage are dropped since the backend has no MFA
 * endpoint in this pass (MFA is Phase 1-scoped to Super Admin/Finance only,
 * per PROJECT.md) — building UI against a non-existent endpoint would be
 * dead code. Logo, headline copy, and layout are kept for visual fidelity.
 */
export function LoginPage() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
    } catch {
      setError('The email or password you entered is incorrect.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1.1fr 1fr' }}>
      <div
        style={{
          background: 'var(--surface-chrome)',
          padding: 'var(--space-16) var(--space-12)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <Logo variant="horizontal-navy" height={38} />
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
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-on-chrome-secondary)' }}>
          Shanitah General Enterprises Ltd · Kampala, Uganda
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-12)' }}>
        <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 360 }}>
          <h2 style={{ font: 'var(--type-section-title)', fontSize: 'var(--text-2xl)', color: 'var(--text-heading)' }}>
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
              <p style={{ font: 'var(--type-body-dense)', color: 'var(--kr-error)' }} role="alert">
                {error}
              </p>
            )}
            <FormField label="Work email" required>
              <Input
                iconLeft="mail"
                type="email"
                placeholder="you@company.co.ug"
                size="lg"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Password" required>
              <Input
                type="password"
                iconLeft="lock"
                placeholder="••••••••"
                size="lg"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            <Button size="lg" fullWidth iconRight="arrow-right" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
