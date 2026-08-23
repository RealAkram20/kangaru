import type { ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import { Card } from '../components/core/Card'
import { EmptyState } from '../components/feedback/EmptyState'
import { canUseNavItem, canUseNavLevel } from '../lib/navigation'

/**
 * Refuses a route the signed-in role has no business on.
 *
 * The sidebar already hides these entries, but hiding a door is not locking
 * it — a Corporate Employee typing /dispatch got a fully rendered dispatch
 * board showing every vehicle and driver, and could walk all the way to
 * "Confirm assignment" before the server refused. A screen that looks
 * operable and fails at the last step is worse than one that explains
 * itself up front.
 *
 * Still **not** the authorization. Every endpoint behind these pages
 * answers 403 independently (AGENTS.md: frontend permissions are never
 * relied on alone). This spares the user a dead end; the server is what
 * makes it safe.
 *
 * The message names the roles rather than saying "denied", matching how
 * InvoicesPage and RateCardsPage already handle a 403 — a person who has
 * landed somewhere they should not be needs to know who to ask, not that
 * they were caught.
 */
export function RequireNavAccess({ id, children }: { id: string; children: ReactNode }) {
  const { user } = useAuth()

  // Level first, then role (ADR-0059 §1). A fleet's Super Admin holds every
  // permission there is and still has no business in the register of other
  // fleet companies — that is a level question, and no role list can answer
  // it.
  if (
    canUseNavLevel(user?.access_level, id) &&
    canUseNavItem(user?.role, id, user?.capabilities ?? [])
  ) {
    return <>{children}</>
  }

  return (
    <Card>
      <EmptyState
        icon="lock"
        title="This page is not available to your role"
        description="If you need access, ask a Super Admin or your Operations Manager. Your own bookings and trips are on the Bookings and Trips pages."
      />
    </Card>
  )
}
