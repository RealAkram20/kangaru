import { useCallback, useSyncExternalStore } from 'react'

/**
 * The one width at which this application stops being a desktop console.
 *
 * Below it: the sidebar is an off-canvas drawer, list rows are cards rather
 * than table rows, and a detail panel is a full-height sheet rather than a
 * dock. One number, one idea of "small", so those three cannot drift apart
 * and leave a phone with a drawer but a 1905px-wide table.
 *
 * 900px rather than a phone width: it is where `useSidebarState` already
 * switched, and a portrait tablet has no more room for a ten-column table
 * than a phone does.
 */
export const COMPACT_MAX_WIDTH = 900

export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`

/**
 * Subscribes to a media query and re-renders when it changes.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, for two
 * reasons. It reads the current value during render, so the first paint is
 * already correct — deriving it in an effect renders the desktop layout for
 * one frame and then swaps, which on a phone is a visible flash of a table
 * about to become cards. And writing state from an effect body is what this
 * project's React Compiler lint rule (`react-hooks/set-state-in-effect`)
 * forbids; the subscribe/getSnapshot pair is the API meant for exactly this
 * kind of external source, with no state to write.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )

  // Returns a boolean, so React's identity check is a value comparison and a
  // fresh MediaQueryList per call cannot cause a re-render loop.
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  // Server snapshot: there is no SSR here, but the argument is required and
  // "not compact" is the safer default — a desktop layout on a phone is
  // recoverable on the first paint, a phone layout on a desktop is not.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** True on phones and portrait tablets. The app's single "small screen" test. */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY)
}
