import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

/** Shared with the pre-paint script in index.html — keep both in step. */
const STORAGE_KEY = 'kangaru.theme'

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Blocked storage — fall through to the OS preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface ThemeState {
  theme: Theme
  isDark: boolean
  toggle: () => void
}

/**
 * Flips `<html data-theme>`, which swaps the semantic colour tokens in
 * `styles/tokens/colors.css`. Components never branch on the theme — they
 * already read the semantic tokens, so the whole app follows this one attribute.
 */
export function useTheme(): ThemeState {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    // Native controls (scrollbars, form widgets) need telling separately.
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Preference just won't survive the reload.
    }
  }, [theme])

  const toggle = useCallback(
    () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    [],
  )

  return { theme, isDark: theme === 'dark', toggle }
}
