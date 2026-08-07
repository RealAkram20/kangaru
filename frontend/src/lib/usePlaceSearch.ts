import { useEffect, useState } from 'react'
import { searchPlaces, type PlaceHit } from '../pages/public/places'

/**
 * Debounced geocoder suggestions for an address box.
 *
 * The **behaviour** of place search, extracted so the public order flow and
 * the internal booking dialog share it. The chrome is deliberately not
 * shared: a consumer flow and an operator console are different visual
 * languages, and forcing one component to be both would make it worse at
 * each. What must not be duplicated is this — the debounce, the abort, the
 * minimum length, and the "only search what the user typed" rule.
 *
 * ## Why `dirty` exists
 *
 * Without it, filling the box programmatically — from a URL parameter, from
 * the device's own position, from a previously picked place — would fire a
 * search for text nobody typed, and drop a suggestion list over a field the
 * user had already settled. Searching resumes the moment they type.
 */
export function usePlaceSearch(value: string) {
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const query = value.trim()
    const controller = new AbortController()

    const timer = setTimeout(() => {
      // Three characters, because two matches most of Kampala and costs a
      // geocoder call to say so.
      if (query.length < 3 || !dirty) {
        setHits([])

        return
      }

      void searchPlaces(query, controller.signal).then(setHits)
    }, 300)

    return () => {
      clearTimeout(timer)
      // Aborts the in-flight request, so a fast typist's earlier query
      // cannot land after a later one and repopulate the list with stale
      // suggestions.
      controller.abort()
    }
  }, [value, dirty])

  return {
    hits,
    /** Call from the input's own onChange — this is what "typed" means. */
    markTyped: () => setDirty(true),
    /** Call when a suggestion is taken: the list closes and stays closed. */
    settle: () => {
      setHits([])
      setDirty(false)
    },
  }
}
