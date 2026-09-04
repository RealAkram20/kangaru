import { ActingAsBanner } from './ActingAsBanner'
import { useActingAs } from './useActingAs'

/**
 * The acting-as banner, for screens that render outside `AppShell`
 * (ADR-0066 §5).
 *
 * ## Why the public routes need one at all
 *
 * They did not, until a walk-in could be a subject. Every earlier session put
 * a support agent inside the console, where `AppShell` draws the banner and
 * nothing else had to know. A walk-in has no console — the staff surface
 * answers 403 for all but four routes while their account is held — so the
 * agent is sent to the order flow instead, which is a `Standalone` route with
 * no chrome of any kind.
 *
 * Without this, the single most consequential state in the product would be
 * the one with nothing on screen to say so: a support agent looking at a
 * member of the public's live ride, able to cancel it, with no banner, no
 * name, and no way out but the browser's back button.
 *
 * ## Mounted in `Standalone` rather than in the order page
 *
 * So it cannot be forgotten. A public route added next month gets it without
 * anybody remembering, and the alternative — the order page owning it — is a
 * rule that lives in one file and applies to several.
 *
 * The cost is bounded: `useActingAs` asks nothing at all unless a staff token
 * is stored, so a walk-in visiting the order page makes no extra request, and
 * neither does a first-time visitor. A signed-in staff member browsing the
 * public pages makes one, once, per navigation — which is the population this
 * is for.
 */
export function ActingAsChrome() {
  const { session, stopping, stop } = useActingAs()

  if (!session) return null

  return <ActingAsBanner session={session} onStop={() => void stop()} stopping={stopping} />
}
