import { Suspense } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import type { User } from '../../types/auth'
import { IconButton } from '../core/IconButton'
import { RouteFallback } from '../feedback/RouteFallback'
import { filterSections, navLabel, navPath } from '../../lib/navigation'
import { menuFor } from '../../lib/menu'
import { ActingAsBanner } from '../security/ActingAsBanner'
import { useActingAs } from '../security/useActingAs'
import { SidebarNav } from '../navigation/SidebarNav'
import { useSidebarState } from '../navigation/useSidebarState'
import { Topbar } from '../navigation/Topbar'
import { useTheme } from '../../theme/useTheme'

/**
 * The name in the topbar chip: whose console this is.
 *
 * Ordered by how specific the answer is. A client's own name beats anything
 * derived; a fleet's name is next; and only an account belonging to neither
 * is Kangaru itself. The `tenant_id` fallback at the end is for a response
 * from an API older than `tenant_name`, which would otherwise show nothing.
 */
function whoseConsole(user: User): string {
  if (user.tenant_name != null) return user.tenant_name
  if (user.operator_name != null) return user.operator_name
  if (user.access_level === 'kangaru') return 'Kangaru'
  if (user.tenant_id !== null) return `Client ${user.tenant_id}`

  return 'Platform'
}

/** Sidebar item ids mapped to their route. Every item now has one. */
const NAV_PATHS: Partial<Record<string, string>> = {
  // `/` now belongs to the public landing page (ADR-0012 §5); the
  // dashboard lives at its own path and `/` redirects signed-in users here.
  dashboard: '/dashboard',
  fleets: '/fleets',
  bookings: '/bookings',
  dispatch: '/dispatch',
  'walk-ins': '/order-requests',
  trips: '/trips',
  'live-map': '/live-map',
  routes: '/routes',
  companies: '/companies',
  customers: '/customers',
  vehicles: '/vehicles',
  drivers: '/drivers',
  'driver-applications': '/driver-applications',
  'support-requests': '/support-requests',
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
  '/fleets': { id: 'fleets', title: 'Fleet companies' },
  '/bookings': { id: 'bookings', title: 'Bookings' },
  '/dispatch': { id: 'dispatch', title: 'Dispatch board' },
  '/order-requests': { id: 'walk-ins', title: 'Walk-in orders' },
  '/trips': { id: 'trips', title: 'Trips' },
  '/live-map': { id: 'live-map', title: 'Live map' },
  '/routes': { id: 'routes', title: 'Routes' },
  '/routes/new': { id: 'routes', title: 'New route' },
  '/companies': { id: 'companies', title: 'Companies' },
  // `navLabel` renames this to "Organisation" for a client's own people.
  '/company': { id: 'companies', title: 'Companies' },
  '/customers': { id: 'customers', title: 'Customers' },
  '/vehicles': { id: 'vehicles', title: 'Vehicles' },
  '/drivers': { id: 'drivers', title: 'Drivers' },
  '/driver-applications': { id: 'driver-applications', title: 'Driver applications' },
  '/support-requests': { id: 'support-requests', title: 'Driver reports' },
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
  // Whether somebody is holding this account for support. Null for everybody
  // who is simply themselves, which is almost every session.
  const actingAs = useActingAs()

  // Exact match first; `/trips/29` is the record page and lights the Trips
  // entry the way any trip does.
  const found =
    PAGE_BY_PATH[location.pathname] ??
    (location.pathname.startsWith('/trips/') ? { id: 'trips', title: 'Trip record' } : undefined) ??
    // `/fleets/3` is one fleet company, and lights the register the way
    // a trip record lights Trips.
    (location.pathname.startsWith('/fleets/') ? { id: 'fleets', title: 'Fleet company' } : undefined) ??
    // `/routes/12` is the builder editing an existing circuit, and lights
    // the Routes entry the way `/routes/new` does.
    (location.pathname.startsWith('/routes/') ? { id: 'routes', title: 'Route' } : undefined)
  const page = found ? { id: found.id, title: navLabel(user?.role, found.id, found.title) } : { id: '', title: '' }

  // Two filters, in order (ADR-0059 §1). The **level** decides which menu
  // exists at all — a fleet's board is not a thing in Kangaru's world — and
  // the **role** then narrows it, which is what the console has always done.
  //
  // Neither is authorization: every endpoint behind these entries answers 403
  // on its own (AGENTS.md). They exist because a menu offering eleven
  // destinations to somebody who can open four is a maze, and one of the
  // eleven rendered a working dispatch board to a Corporate Employee.
  const sections = filterSections(menuFor(user?.access_level), user)

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
          // Role-aware: a client's own organisation lives at /company.
          if (path) navigate(navPath(user?.role, id, path))
          // The drawer sits over the page it just navigated to.
          sidebar.closeMobile()
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/*
          Above the topbar and inside the column, so it pushes the console down
          rather than floating over it (ADR-0056 §5). An overlay would let
          content hide behind it and would read as a notification that arrived
          — which is the one thing a permanent indicator must not do.
        */}
        {actingAs.session && (
          <ActingAsBanner
            session={actingAs.session}
            onStop={() => void actingAs.stop()}
            stopping={actingAs.stopping}
          />
        )}
        <Topbar
          title={page.title}
          onOpenProfile={() => navigate('/profile')}
          onSignOut={() => void logout()}
          // Whose console this is — and it has to answer for all three
          // levels, not two. `tenant_id` is null for a **fleet** account and
          // null for a **Kangaru** account alike, so keying off it alone said
          // "Platform" to both: a Super Admin at Shanitah and a Super Admin at
          // head office got an identical topbar and two different menus, which
          // is the worst way round.
          //
          // A client sees their own organisation, a fleet sees theirs, and
          // head office sees Kangaru. An API older than these fields still
          // gets a chip rather than none.
          tenant={user ? whoseConsole(user) : undefined}
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
          {/*
            Every routed page is lazily loaded (routes/router.tsx), so the
            boundary belongs here rather than around the whole shell: the
            sidebar and topbar stay on screen and keep working while the next
            page's chunk arrives, and only this pane shows the placeholder.
          */}
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
