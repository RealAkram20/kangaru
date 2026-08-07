import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { IconButton } from '../core/IconButton'
import { filterSections } from '../../lib/navigation'
import { SidebarNav, type SidebarSection } from '../navigation/SidebarNav'
import { useSidebarState } from '../navigation/useSidebarState'
import { Topbar } from '../navigation/Topbar'
import { useTheme } from '../../theme/useTheme'

const SECTIONS: SidebarSection[] = [
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

/** Sidebar item ids mapped to their route. Every item now has one. */
const NAV_PATHS: Partial<Record<string, string>> = {
  // `/` now belongs to the public landing page (ADR-0012 §5); the
  // dashboard lives at its own path and `/` redirects signed-in users here.
  dashboard: '/dashboard',
  bookings: '/bookings',
  dispatch: '/dispatch',
  'walk-ins': '/order-requests',
  trips: '/trips',
  companies: '/companies',
  customers: '/customers',
  vehicles: '/vehicles',
  drivers: '/drivers',
  invoices: '/invoices',
  'rate-cards': '/rate-cards',
  reports: '/reports',
  notifications: '/notifications',
  staff: '/staff',
  roles: '/roles',
  'audit-log': '/audit-log',
  'system-settings': '/system-settings',
}

const PAGE_BY_PATH: Record<string, { id: string; title: string }> = {
  '/dashboard': { id: 'dashboard', title: 'Dashboard' },
  '/bookings': { id: 'bookings', title: 'Bookings' },
  '/dispatch': { id: 'dispatch', title: 'Dispatch board' },
  '/order-requests': { id: 'walk-ins', title: 'Walk-in orders' },
  '/trips': { id: 'trips', title: 'Trips' },
  '/companies': { id: 'companies', title: 'Companies' },
  '/customers': { id: 'customers', title: 'Customers' },
  '/vehicles': { id: 'vehicles', title: 'Vehicles' },
  '/drivers': { id: 'drivers', title: 'Drivers' },
  '/invoices': { id: 'invoices', title: 'Invoices' },
  '/rate-cards': { id: 'rate-cards', title: 'Rate cards' },
  '/reports': { id: 'reports', title: 'Reports' },
  '/notifications': { id: 'notifications', title: 'Notifications' },
  '/staff': { id: 'staff', title: 'Staff' },
  '/roles': { id: 'roles', title: 'Roles' },
  '/audit-log': { id: 'audit-log', title: 'Audit log' },
  // `profile` matches no sidebar *item*; SidebarNav highlights the identity
  // card on that id instead, which is where the page is reached from.
  '/profile': { id: 'profile', title: 'Profile' },
  '/system-settings': { id: 'system-settings', title: 'Settings' },
}

/**
 * Shared chrome (SidebarNav + Topbar) for every page behind auth. Extracted
 * once two pages need it, so the active-highlight and sign-out wiring can't
 * drift between them. Sign-out lives in the topbar's account menu, and your
 * own Profile is reachable from both that menu and the sidebar identity
 * card; the theme switch stays in the sidebar.
 */
export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const sidebar = useSidebarState()
  const theme = useTheme()

  const page = PAGE_BY_PATH[location.pathname] ?? { id: '', title: '' }

  // Convenience, not authorization — every endpoint behind these entries
  // answers 403 on its own (AGENTS.md). It exists because a menu offering
  // eleven destinations to somebody who can open four is a maze, and one of
  // the eleven rendered a working dispatch board to a Corporate Employee.
  const sections = filterSections(SECTIONS, user)

  return (
    // Pinned to the viewport, not to the content: a long page (the dashboard's
    // activity feed) must scroll inside <main>, never stretch the sidebar.
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/*
        `bottomItems` no longer carries Logout: signing out moved into the
        Topbar account menu, where it sits under the name it signs out of.
        Two of them would be one too many, and the sidebar one was the
        harder to find.
      */}
      <SidebarNav
        id="app-sidebar"
        sections={sections}
        active={page.id}
        user={user ? { name: user.name, role: user.role_label ?? user.role } : undefined}
        onUserClick={() => {
          navigate('/profile')
          // Same as the nav items: the drawer sits over the page it just
          // navigated to otherwise.
          sidebar.closeMobile()
        }}
        bottomItems={[
          {
            id: 'theme',
            label: 'Dark Mode',
            icon: theme.isDark ? 'moon' : 'sun',
            checked: theme.isDark,
          },
        ]}
        collapsed={sidebar.collapsed}
        mobile={sidebar.isMobile}
        open={sidebar.mobileOpen}
        onClose={sidebar.closeMobile}
        onNavigate={(id) => {
          if (id === 'theme') {
            theme.toggle()
            return
          }
          const path = NAV_PATHS[id]
          if (path) navigate(path)
          // The drawer sits over the page it just navigated to.
          sidebar.closeMobile()
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          title={page.title}
          onOpenProfile={() => navigate('/profile')}
          onSignOut={() => void logout()}
          tenant={user ? `Tenant ${user.tenant_id ?? '—'}` : undefined}
          user={
            user
              ? { name: user.name, role: user.role_label ?? user.role, email: user.email }
              : undefined
          }
          leading={
            <IconButton
              icon={sidebar.isMobile || sidebar.collapsed ? 'panel-left' : 'panel-left-close'}
              label={
                sidebar.collapsed || (sidebar.isMobile && !sidebar.mobileOpen)
                  ? 'Expand sidebar'
                  : 'Collapse sidebar'
              }
              size="sm"
              onChrome
              onClick={sidebar.toggle}
              aria-controls="app-sidebar"
              aria-expanded={sidebar.isMobile ? sidebar.mobileOpen : !sidebar.collapsed}
              style={{ marginLeft: 'calc(var(--space-2) * -1)' }}
            />
          }
        />
        <main
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            // Not decoration, and not for positioning anything of its own:
            // `overflow` only clips absolutely positioned descendants whose
            // containing block it *is*, and a static box is nobody's
            // containing block. Without this, every sr-only clip in the page
            // (FormField's "(required)", Checkbox's real input) resolves
            // against the initial containing block, escapes this scroller,
            // and lands in the document's scrollable overflow.
            //
            // The symptom was a second scrollbar on the whole window and a
            // band of empty page below the 100vh shell — worst on Settings,
            // where a tall form put the last clipped span ~2500px down.
            position: 'relative',
            background: 'var(--surface-page)',
            padding: 'var(--space-6)',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
