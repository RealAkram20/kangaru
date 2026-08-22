import type { SidebarSection } from '../../components/navigation/SidebarNav'
import { CLIENT_MENU } from './client'
import { FLEET_MENU } from './fleet'
import { KANGARU_MENU } from './kangaru'

/**
 * Which menu exists for an account, before role narrows it (ADR-0059 §1).
 *
 * Two different questions, and the console has only ever answered the second.
 * *"May a Dispatcher open the dispatch board?"* is a **role** question, and
 * `canUseNavItem` answers it. *"Does a dispatch board exist in this person's
 * world at all?"* is a **level** question, and nothing answered it — which is
 * why a Kangaru account is currently offered twelve destinations that ADR-0055
 * §2 says belong to a fleet.
 *
 * Answering the second with a role list would mean denying every new
 * Kangaru-only entry to six fleet roles individually, forever, and one
 * forgotten entry is a fleet reading Kangaru's plans. That fails toward
 * exposure. A level list fails toward an empty menu.
 */
export type AccessLevel = 'kangaru' | 'fleet' | 'client' | 'applicant'

const BY_LEVEL: Record<AccessLevel, SidebarSection[]> = {
  kangaru: KANGARU_MENU,
  fleet: FLEET_MENU,
  client: CLIENT_MENU,
  // ADR-0055 §4: an applicant's reach is keyed off their own id and
  // `AccessContext` leaves them unbound. They have a screen, not a console.
  applicant: [],
}

/**
 * The menu for a level.
 *
 * **An unknown or absent level gets the fleet menu, not an empty one.** That
 * is a deliberate exception to this repo's fail-closed instinct and it is
 * worth stating plainly: `access_level` is served by an API that may be older
 * than this field, and every account that exists today is `fleet` or `client`
 * — so failing closed here would blank the console for everybody on a stale
 * deployment, in the one component that renders before anything else.
 *
 * It is safe *because* it is not authorization. Menu visibility is a
 * convenience over server rules that answer 403 on their own
 * (`navigation.ts`), so the worst case of this default is a door that refuses,
 * which the console already handles. The worst case of the opposite is a
 * signed-in user with no navigation at all.
 */
export function menuFor(level: string | undefined): SidebarSection[] {
  if (level !== undefined && level in BY_LEVEL) return BY_LEVEL[level as AccessLevel]

  return FLEET_MENU
}

export { CLIENT_MENU, FLEET_MENU, KANGARU_MENU }
