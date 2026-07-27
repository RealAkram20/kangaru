import { useAuth } from '../auth/useAuth'
import { SidebarNav } from '../components/navigation/SidebarNav'
import { Topbar } from '../components/navigation/Topbar'

const SECTIONS = [
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
 * Bare Dashboard shell for this scaffolding pass: Topbar + SidebarNav +
 * empty content area. Full widget/KPI content is out of scope.
 */
export function DashboardPage() {
  const { user, logout } = useAuth()

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarNav sections={SECTIONS} active="dashboard" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          title="Dashboard"
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
          <p style={{ font: 'var(--type-body)', color: 'var(--text-secondary)' }}>
            Welcome, {user?.name}. This is the Phase 1 scaffold — module content ships in later
            passes.
          </p>
        </main>
      </div>
    </div>
  )
}
