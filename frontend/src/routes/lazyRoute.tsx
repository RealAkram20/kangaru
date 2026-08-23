import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { RouteFallback } from '../components/feedback/RouteFallback'

/**
 * A Suspense boundary for routes that render outside `AppShell`.
 *
 * The shell has its own boundary around `<Outlet/>`, so its children keep the
 * sidebar and topbar on screen while a chunk loads. The public routes and the
 * MFA enrolment screen have no such chrome, so they get a padded boundary of
 * their own.
 */
export function Standalone({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 'var(--space-6)', minHeight: '100vh' }}>
          <RouteFallback />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}
