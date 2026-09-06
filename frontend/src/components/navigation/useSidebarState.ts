import { useCallback, useEffect, useState } from 'react'
import { COMPACT_QUERY } from '../../lib/useMediaQuery'

/** Survives reloads, so the rail preference sticks per browser. */
const STORAGE_KEY = 'kangaru.sidebar.collapsed'

/**
 * Below this the 64px rail leaves too little room, so the sidebar goes
 * off-canvas instead.
 *
 * Now shared with the table/card switch and the detail sheet rather than
 * being this file's private constant — three components deciding
 * independently what "small" means is how a phone ends up with a drawer and
 * a ten-column table at the same time.
 */
const MOBILE_QUERY = COMPACT_QUERY

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export interface SidebarState {
  /** Desktop only — icon-only rail. Always false while `isMobile`. */
  collapsed: boolean
  isMobile: boolean
  /** Mobile only — the off-canvas drawer is showing. */
  mobileOpen: boolean
  /** Collapses the rail on desktop, opens/closes the drawer on mobile. */
  toggle: () => void
  closeMobile: () => void
}

/**
 * Drives the collapsible SidebarNav: desktop collapses to the icon rail and
 * remembers it, mobile slides the full sidebar in over the page. Cmd/Ctrl+B
 * toggles either mode, Escape closes the mobile drawer.
 */
export function useSidebarState(): SidebarState {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
      // Leaving mobile with the drawer open would strand the scrim over the page.
      if (!event.matches) setMobileOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // Private mode / blocked storage — the toggle still works for this session.
    }
  }, [collapsed])

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  const toggle = useCallback(() => {
    if (isMobile) setMobileOpen((open) => !open)
    else setCollapsed((value) => !value)
  }, [isMobile])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggle()
      } else if (event.key === 'Escape') {
        setMobileOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggle])

  return { collapsed: isMobile ? false : collapsed, isMobile, mobileOpen, toggle, closeMobile }
}
