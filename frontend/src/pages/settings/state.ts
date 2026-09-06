import { createContext, useCallback, useState } from 'react'

/**
 * The non-rendering half of the settings kit: form state, payload helpers and
 * the page's context.
 *
 * Split from `kit.tsx` rather than living beside the components it serves,
 * because `react-refresh/only-export-components` is right — a module that
 * exports both a component and a hook loses fast refresh for everything in it,
 * and this file is edited far less often than the sections are.
 */

export type Primitive = string | number | boolean

export interface SectionState<T extends Record<string, Primitive>> {
  value: T
  set: <K extends keyof T>(key: K, next: T[K]) => void
  /** Empties the named boxes — the credentials, once the server has them. */
  clear: (keys: (keyof T)[]) => void
  reset: () => void
  dirty: boolean
}

/**
 * One section's editable state, and whether it still matches what is stored.
 *
 * A flat record rather than a `useState` per field, because "has this section
 * been edited" is the question the whole page is organised around — the action
 * bar, the Discard button and the marker in the section rail all read it — and
 * eleven separate pieces of state cannot answer it without eleven comparisons
 * written out by hand in every section.
 *
 * `initial` is rebuilt from props on every render, so after a save it becomes
 * the values that were just saved and `dirty` falls back to false on its own.
 * The exception is a credential box, whose initial is always `''`; `clear`
 * empties those once the server has them.
 */
export function useSectionState<T extends Record<string, Primitive>>(initial: T): SectionState<T> {
  const [value, setValue] = useState<T>(initial)

  const set = useCallback(<K extends keyof T>(key: K, next: T[K]) => {
    setValue((current) => ({ ...current, [key]: next }))
  }, [])

  const clear = useCallback((keys: (keyof T)[]) => {
    setValue((current) => {
      const next = { ...current }
      for (const key of keys) next[key] = '' as T[keyof T]
      return next
    })
  }, [])

  const reset = useCallback(() => setValue(initial), [initial])

  const dirty = (Object.keys(initial) as (keyof T)[]).some((key) => value[key] !== initial[key])

  return { value, set, clear, reset, dirty }
}

/** Drops empty-string secrets, so "leave it" is absence rather than a blank write. */
export function withSecrets(
  values: Record<string, unknown>,
  secrets: Record<string, string>,
): Record<string, unknown> {
  const out = { ...values }
  for (const [key, value] of Object.entries(secrets)) {
    if (value !== '') out[key] = value
  }
  return out
}

/** `'' -> null`, so an emptied optional field clears rather than storing "". */
export function orNull(value: string): string | null {
  return value === '' ? null : value
}

/** One entry in the section rail, and the heading of the pane it opens. */
export interface SectionMeta {
  id: string
  /** The `PATCH /settings/{group}` segment. Equals `id` for every group today. */
  group: string
  /** What the rail calls it — shorter than the pane's own title where it helps. */
  label: string
  /** Lucide name — DESIGN.md §7. */
  icon: string
  title: string
  description?: string
}

export interface SettingsPageContext {
  /** Lets the rail mark a section the reader has edited but not saved. */
  reportDirty: (section: string, dirty: boolean) => void
}

export const PageContext = createContext<SettingsPageContext>({ reportDirty: () => {} })
