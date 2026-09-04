import { lazy } from 'react'
import type { ComponentType } from 'react'

/**
 * `React.lazy` for a module that exports its component by name.
 *
 * Every page in this app is a named export (`export function TripsPage`), and
 * `lazy` wants a module whose `default` is the component, so each one needs
 * unwrapping. `routes/router.tsx` uses this to code-split all 27 pages.
 *
 * In its own module, and not beside `Standalone`: a file that exports both a
 * component and a plain function breaks Fast Refresh, which would remount the
 * tree on every edit.
 */
export function page<T extends Record<string, unknown>, K extends keyof T>(
  load: () => Promise<T>,
  name: K,
): ComponentType<Record<string, never>> {
  return lazy(async () => ({
    default: (await load())[name] as ComponentType<Record<string, never>>,
  }))
}
