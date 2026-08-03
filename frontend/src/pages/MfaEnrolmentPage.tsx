import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { MfaEnrolmentFlow } from '../components/security/MfaEnrolmentFlow'

/**
 * Setting up a second factor because you must (ADR-0008 decision 3).
 *
 * Reached because the user has to be here: a Super Admin or Finance officer
 * who has not enrolled can authenticate and then do **nothing else** —
 * every other endpoint answers 403 `MFA_ENROLMENT_REQUIRED`. Enrolment is
 * forced rather than nagged, because a grace period is a schedule for being
 * non-compliant and the people who ignore it longest are the ones with the
 * most access.
 *
 * The sequence itself — scan, prove, keep the codes — is
 * `MfaEnrolmentFlow`, shared with the voluntary path on the Settings page
 * (ADR-0010). This page owns only what is specific to being forced: the
 * framing, and the way out.
 */
export function MfaEnrolmentPage() {
  const { user, markMfaEnrolled, refreshUser, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-8)' }}>
      <Card
        title="Set up two-factor authentication"
        subtitle={`Required for ${user?.role_label ?? user?.role.replace(/_/g, ' ') ?? 'your role'} — this role can issue invoices and change rates.`}
      >
        <MfaEnrolmentFlow
          onDone={() => {
            markMfaEnrolled()
            // Refreshed rather than patched: mfa_enabled and the recovery
            // code count changed server-side, and Settings reads both.
            void refreshUser()
            navigate('/', { replace: true })
          }}
        />

        {/*
          Signing out has to stay reachable. Somebody who does not have
          their phone to hand cannot enrol, and trapping them in an
          application they can neither use nor leave is its own bug — the
          server keeps `auth.logout` on the allowlist for the same reason.
        */}
        <Button variant="ghost" onClick={() => void logout()} style={{ marginTop: 'var(--space-4)' }}>
          Sign out
        </Button>
      </Card>
    </div>
  )
}
