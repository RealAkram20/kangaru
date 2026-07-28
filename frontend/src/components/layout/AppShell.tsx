import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { SidebarNav, type SidebarSection } from '../navigation/SidebarNav'
import { Topbar } from '../navigation/Topbar'

const SECTIONS: SidebarSection[] = [
  {
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' }],
  },
  {
    label: 'Operations',
    items: [
      { id: 'dispatch', label: 'Dispatch', icon: 'route' },
      { id: 'trips', label: 'Trips', icon: 'navigation' },
      { id: 'companies', label: 'Companies', icon: 'building-2' },
    ],
  },
]

/**
 * Sidebar item ids that have a real route. Dispatch/Trips stay visible in
 * the nav (so the eventual shape of the product is legible) but no-op on
 * click until those modules exist — no route to send them to yet.
 */
const NAV_PATHS: Partial<Record<string, string>> = {
  dashboard: '/',
  companies: '/companies',
}

const PAGE_BY_PATH: Record<string, { id: string; title: string }> = {
  '/': { id: 'dashboard', title: 'Dashboard' },
  '/companies': { id: 'companies', title: 'Companies' },
}

/**
 * Shared chrome (SidebarNav + Topbar + sign-out) for every page behind
 * auth. Extracted once two pages need it, so the active-highlight and
 * sign-out wiring can't drift between them.
 */
export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const page = PAGE_BY_PATH[location.pathname] ?? { id: '', title: '' }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarNav
        sections={SECTIONS}
        active={page.id}
        onNavigate={(id) => {
          const path = NAV_PATHS[id]
          if (path) navigate(path)
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          title={page.title}
          tenant={user ? `Tenant ${user.tenant_id ?? '—'}` : undefined}
          user={user ? { name: user.name, role: user.role } : undefined}
          actions={
            <button
              onClick={() => void logout()}
              style={{
                font: 'var(--type-label)',
                color: 'var(--text-on-chrome-secondary)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          }
        />
        <main style={{ flex: 1, background: 'var(--surface-page)', padding: 'var(--space-6)' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
