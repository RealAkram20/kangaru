import type { SidebarSection } from '../../components/navigation/SidebarNav'

/**
 * Head office's menu — `access_level: 'kangaru'` (ADR-0059).
 *
 * **Identical to the fleet and client menus today, and that is deliberate.**
 * `K1` ships the mechanism and changes nothing anybody can see; `K4` is what
 * cuts this list down to what Kangaru actually owns. A change to the file
 * every other package wants to touch should not also change what people see.
 *
 * Three files holding the same list is normally the drift hazard the vehicle
 * census exists to catch. It is not that here: **divergence is the point.**
 * These three lists are meant to stop resembling each other, and the moment
 * one of them changes is the moment the split earns itself. Do not factor them
 * back into a shared constant with per-level filters — that is the single
 * `SECTIONS` this replaced.
 */
export const KANGARU_MENU: SidebarSection[] = [
  {
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' }],
  },
  {
    // ADR-0055 / ADR-0059: the fleet companies Kangaru manages, and what they
    // pay to be here (ADR-0058).
    label: 'The network',
    items: [
      { id: 'fleets', label: 'Fleet companies', icon: 'building-2' },
      // ADR-0062. Head office reads the **directory** — who is on the platform
      // and which fleet serves them — and never the operations. `K4` gave this
      // level a count and no list on ADR-0055 §2's reasoning; that could not
      // survive head office being able to onboard a client and then unable to
      // see the one it had just created.
      { id: 'clients', label: 'Corporate clients', icon: 'briefcase' },
      // ADR-0058. What a fleet pays to be here — Kangaru's own commercial
      // relationship with each of them, and nobody else's business.
      { id: 'plans', label: 'Plans', icon: 'tags' },
    ],
  },
  {
    // Kangaru's own operation. A walk-in has no contract and no fleet behind
    // it — the fare is Kangaru's public tariff and the commission is
    // Kangaru's, which is why this is the one queue head office works itself.
    label: 'Walk-in economy',
    items: [
      { id: 'walk-ins', label: 'Walk-in orders', icon: 'phone-call' },
      { id: 'customers', label: 'Walk-in clients', icon: 'contact' },
      // ADR-0055 §5. Drivers asking to take walk-in work, from any fleet.
      // Here rather than under the network because it is Kangaru's own
      // economy the driver is joining, not a fact about their employer.
      { id: 'driver-contracts', label: 'Driver contracts', icon: 'file-signature' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { id: 'reports', label: 'Reports', icon: 'file-chart-column' },
      { id: 'audit-log', label: 'Audit log', icon: 'file-clock' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'staff', label: 'Kangaru staff', icon: 'user-cog' },
      { id: 'roles', label: 'Roles', icon: 'shield-check' },
      { id: 'system-settings', label: 'Settings', icon: 'sliders-horizontal' },
    ],
  },
  {
    // Its own section rather than an Administration item: a notification is
    // addressed to you personally, not to a part of the business.
    items: [{ id: 'notifications', label: 'Notifications', icon: 'bell' }],
  },
]
