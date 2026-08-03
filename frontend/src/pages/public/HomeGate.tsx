import { Navigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { LandingPage } from './LandingPage'

/**
 * `/` serves two audiences (ADR-0012 §5): a visitor gets the public
 * landing page; a signed-in user goes to the dashboard, which moved to
 * `/dashboard` to make room. Bookmarks to `/` keep working for both.
 */
export function HomeGate() {
  const { user, loading } = useAuth()

  if (loading) {
    return null
  }

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return <LandingPage />
}
