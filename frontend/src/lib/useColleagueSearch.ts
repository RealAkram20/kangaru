import { useEffect, useState } from 'react'
import { apiClient } from './apiClient'
import type { ApiSuccess } from '../types/api'
import type { Colleague } from '../types/staff'

/**
 * Debounced colleague lookup for the booking dialog's passenger field.
 *
 * The same shape as `usePlaceSearch`, and for the same reasons — a debounce,
 * an abort, a minimum length, and the rule that only typed text is searched.
 * What is different is why the minimum matters here: a bank's directory is
 * thousands of names, and a request per keystroke would both hammer the
 * endpoint and paint a list that changes under the pointer.
 *
 * `dirty` is what stops the field searching for text nobody typed. The
 * dialog fills the box from a colleague that was already picked, and
 * without this that would immediately reopen a suggestion list over a
 * field the user had settled.
 */
export function useColleagueSearch(value: string) {
  const [hits, setHits] = useState<Colleague[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const query = value.trim()
    const controller = new AbortController()

    const timer = setTimeout(() => {
      // Two, matching the server's own floor — it refuses anything shorter
      // rather than answering with the top of the directory.
      if (query.length < 2 || !dirty) {
        setHits([])

        return
      }

      apiClient
        .get<ApiSuccess<Colleague[]>>('/colleagues', {
          params: { q: query },
          signal: controller.signal,
        })
        .then((response) => setHits(response.data.data))
        // Swallowed on purpose, and only here: a lookup that cannot answer
        // leaves the list empty, and the field still takes a typed name.
        // Surfacing "could not search" beside a working input would be
        // noise in the middle of raising a booking.
        .catch(() => setHits([]))
    }, 250)

    return () => {
      clearTimeout(timer)
      // Aborts the in-flight request, so a fast typist's earlier query
      // cannot land after a later one and repopulate the list with names
      // that no longer match what is in the box.
      controller.abort()
    }
  }, [value, dirty])

  return {
    hits,
    /** Call from the input's own onChange — this is what "typed" means. */
    markTyped: () => setDirty(true),
    /** Call when a colleague is taken: the list closes and stays closed. */
    settle: () => {
      setHits([])
      setDirty(false)
    },
  }
}
