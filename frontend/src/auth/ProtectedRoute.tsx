import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute({
  children,
  allowUnenrolled = false,
}: {
  children: ReactNode
  /**
   * Lets a user who still owes an enrolment through — set only on the
   * enrolment route itself, which would otherwise redirect to itself
   * forever.
   */
  allowUnenrolled?: boolean
}) {
  const { user, loading, mustEnrolMfa } = useAuth()

  if (loading) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // ADR-0008 decision 3. The server is the authority — every endpoint
  // answers 403 MFA_ENROLMENT_REQUIRED for this user regardless of what
  // the client does — so this redirect is a *courtesy*, not the control.
  //
  // Without it the app would render a dashboard whose every panel failed,
  // which is the "blank screen with no explanation" this project has
  // shipped before. With it the user lands on the one page that works.
  if (mustEnrolMfa && !allowUnenrolled) {
    return <Navigate to="/mfa/setup" replace />
  }

  return children
}
