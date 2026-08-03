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
      { id: 'trips', label: 'Trips', icon: 'navigation' },
      { id: 'companies', label: 'Companies', icon: 'building-2' },
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
  dashboard: '/',
  bookings: '/bookings',
  dispatch: '/dispatch',
  trips: '/trips',
  companies: '/companies',
  vehicles: '/vehicles',
  drivers: '/drivers',
  invoices: '/invoices',
  'rate-cards': '/rate-cards',
  reports: '/reports',
  notifications: '/notifications',
  staff: '/staff',
  roles: '/roles',
  'audit-log': '/audit-log',
}

const PAGE_BY_PATH: Record<string, { id: string; title: string }> = {
  '/': { id: 'dashboard', title: 'Dashboard' },
  '/bookings': { id: 'bookings', title: 'Bookings' },
  '/dispatch': { id: 'dispatch', title: 'Dispatch board' },
  '/trips': { id: 'trips', title: 'Trips' },
  '/companies': { id: 'companies', title: 'Companies' },
  '/vehicles': { id: 'vehicles', title: 'Vehicles' },
  '/drivers': { id: 'drivers', title: 'Drivers' },
  '/invoices': { id: 'invoices', title: 'Invoices' },
  '/rate-cards': { id: 'rate-cards', title: 'Rate cards' },
  '/reports': { id: 'reports', title: 'Reports' },
  '/notifications': { id: 'notifications', title: 'Notifications' },
  '/staff': { id: 'staff', title: 'Staff' },
  '/roles': { id: 'roles', title: 'Roles' },
  '/audit-log': { id: 'audit-log', title: 'Audit log' },
}

/**
 * Shared chrome (SidebarNav + Topbar) for every page behind auth. Extracted
 * once two pages need it, so the active-highlight and sign-out wiring can't
 * drift between them. Identity, Settings and sign-out live in the topbar's
 * account menu; the theme switch stays in the sidebar.
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
          onOpenSettings={() => navigate('/settings')}
          onSignOut={() => void logout()}
          tenant={user ? `Tenant ${user.tenant_id ?? '—'}` : undefined}
          user={user ? { name: user.name, role: user.role_label ?? user.role, email: user.email } : undefined}
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
