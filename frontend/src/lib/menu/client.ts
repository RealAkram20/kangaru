import type { SidebarSection } from '../../components/navigation/SidebarNav'

/**
 * A corporate client's menu — `access_level: 'client'` (ADR-0059).
 *
 * The narrowest of the three: a client consumes transport and does not run a
 * fleet. `navigation.ts` already narrows most of this by role, and `filterSections`
 * still runs over whatever this file holds — the level chooses the list, the
 * role filters it.
 *
 * Identical to the other two today. `K1` ships the mechanism; the lists are
 * meant to diverge, and the note in `kangaru.ts` explains why they must not be
 * factored back into one.
 */
export const CLIENT_MENU: SidebarSection[] = [
  {
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' }],
  },
  {
    label: 'Operations',
    items: [
      { id: 'bookings', label: 'Bookings', icon: 'calendar-clock' },
      { id: 'dispatch', label: 'Dispatch', icon: 'route' },
      // ADR-0012: the walk-in order queue, the phone-first half of dispatch.
      { id: 'walk-ins', label: 'Walk-ins', icon: 'phone-call' },
      { id: 'trips', label: 'Trips', icon: 'navigation' },
      // ADR-0019. Beside Trips rather than under Fleet: the question it
      // answers is "where is this job", not "what do we own".
      { id: 'live-map', label: 'Live map', icon: 'map' },
      // ADR-0045. Beside the live map rather than under Administration: a
      // circuit is operational work — where the team goes today — not a
      // setting somebody configures once.
      { id: 'routes', label: 'Routes', icon: 'route' },
      { id: 'companies', label: 'Companies', icon: 'building-2' },
      // ADR-0018. "Customers", not "Clients": Companies already means the
      // corporate clients, and one word for two populations is how a
      // support agent ends up looking in the wrong list.
      { id: 'customers', label: 'Customers', icon: 'contact' },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { id: 'vehicles', label: 'Vehicles', icon: 'truck' },
      { id: 'drivers', label: 'Drivers', icon: 'users' },
      { id: 'driver-applications', label: 'Applications', icon: 'user-plus' },
      // ADR-0044. Under Fleet with the drivers rather than in Operations: it
      // is a queue about the people who drive, gated on the same
      // `drivers.manage` the two entries above it use, and a clerk who
      // handles one handles all three.
      { id: 'support-requests', label: 'Driver reports', icon: 'message-square-warning' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { id: 'invoices', label: 'Invoices', icon: 'receipt' },
      { id: 'rate-cards', label: 'Rate cards', icon: 'tags' },
    ],
  },
  {
    label: 'Insight',
    items: [{ id: 'reports', label: 'Reports', icon: 'file-chart-column' }],
  },
  {
    label: 'Administration',
    items: [
      { id: 'staff', label: 'Staff', icon: 'user-cog' },
      { id: 'roles', label: 'Roles', icon: 'shield-check' },
      { id: 'audit-log', label: 'Audit log', icon: 'file-clock' },
      // ADR-0014: the platform's own configuration. It was labelled "System
      // settings" to keep it apart from a personal Settings entry that used
      // to sit in the section below; that entry is now Profile, reached from
      // the identity card, so the qualifier no longer earns its place —
      // there is exactly one Settings in this menu and this is it.
      { id: 'system-settings', label: 'Settings', icon: 'sliders-horizontal' },
    ],
  },
  {
    // Its own section rather than an Operations item: a notification is
    // addressed to you personally, not to a part of the business, so it
    // does not belong under the same heading as the fleet's work.
    items: [{ id: 'notifications', label: 'Notifications', icon: 'bell' }],
  },
]
