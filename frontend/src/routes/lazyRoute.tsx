import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { RouteFallback } from '../components/feedback/RouteFallback'
import { ActingAsChrome } from '../components/security/ActingAsChrome'

/**
 * A Suspense boundary for routes that render outside `AppShell`.
 *
 * The shell has its own boundary around `<Outlet/>`, so its children keep the
 * sidebar and topbar on screen while a chunk loads. The public routes and the
 * MFA enrolment screen have no such chrome, so they get a padded boundary of
 * their own.
 *
 * ## And, since ADR-0066, the one piece of chrome they cannot do without
 *
 * A support agent holding a **walk-in's** account is sent here, to the order
 * flow, because a walk-in has no console to be sent to. `ActingAsChrome` is
 * what says so on screen. It is mounted here rather than on the order page so
 * that a public route added later gets it without anybody remembering, and it
 * costs nothing for the visitors these pages are actually for — it asks the
 * server nothing unless a staff token is stored.
 */
export function Standalone({ children }: { children: ReactNode }) {
  return (
    <>
      <ActingAsChrome />
      <Suspense
        fallback={
          <div style={{ padding: 'var(--space-6)', minHeight: '100vh' }}>
            <RouteFallback />
          </div>
        }
      >
        {children}
      </Suspense>
    </>
  )
}
