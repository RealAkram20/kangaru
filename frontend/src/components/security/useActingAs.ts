import { useCallback, useEffect, useState } from 'react'
import { apiClient, getStoredToken } from '../../lib/apiClient'
import type { ApiSuccess } from '../../types/api'
import type { ActingAsSession } from './ActingAsBanner'

/**
 * Whether this console is being operated by somebody borrowing the account
 * (ADR-0056 §5).
 *
 * ## Why the console has to ask at all
 *
 * By the time it renders, `ActAsSubject` has already swapped the user, so
 * `auth/me` answers as the **subject**. Without this the browser would render
 * as that person with nothing whatsoever to say it was not really them — which
 * is the failure the banner exists to prevent, and it would have been silent.
 *
 * ## Asked once, on load
 *
 * Not polled. A session lasts thirty minutes and is ended deliberately; a timer
 * ticking against the API on every console in the building, to catch a state
 * almost nobody is ever in, is the kind of cost `PRODUCT.md`'s "lean, no wasted
 * requests" line exists to refuse.
 *
 * The one case it misses — a session that lapses while the tab sits open — is
 * covered by the server rather than the client: every request after expiry is
 * already the actor as themselves, because `live()` stops matching. The banner
 * being briefly stale is a cosmetic wrong; a request being wrongly scoped is
 * not, and that half is not the client's to guarantee.
 */
export function useActingAs() {
  const [session, setSession] = useState<ActingAsSession | null>(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    if (!getStoredToken()) {
      return
    }

    apiClient
      .get<ApiSuccess<ActingAsSession | null>>('/support/act-as')
      // Swallowed deliberately. This is chrome, not a feature: an older API,
      // a dropped connection or a 403 must leave the console working rather
      // than fail a page load over a banner almost nobody will see.
      .then((response) => setSession(response.data.data ?? null))
      .catch(() => setSession(null))
  }, [])

  const stop = useCallback(async () => {
    setStopping(true)

    try {
      await apiClient.delete('/support/act-as')
    } finally {
      // A full reload, not `setSession(null)`. Every screen behind this was
      // rendered from the subject's data — their trips, their prices, their
      // navigation — and clearing the banner alone would leave a support agent
      // looking at somebody else's console with nothing saying so, which is
      // worse than the state the banner was drawn to prevent.
      window.location.assign('/')
    }
  }, [])

  return { session, stopping, stop }
}
