import { useCallback, useEffect, useState } from 'react'
import {
  fetchCustomer,
  getStoredCustomerToken,
  logoutCustomer,
  type Customer,
} from './customerAuth'

export interface CustomerSession {
  customer: Customer | null
  /** True until the stored token has been resolved, so nothing flashes signed-out. */
  loading: boolean
  /** Adopt an account this component just created or signed in. */
  adopt: (customer: Customer) => void
  signOut: () => Promise<void>
}

/**
 * The customer session, resolved from the stored token on mount.
 *
 * A plain hook rather than a context provider, unlike staff `useAuth`:
 * the customer surface is currently one screen (the order flow), and a
 * provider around the whole app would resolve a token on every staff
 * page load for a principal those pages have no use for. If a customer
 * account area grows past the order page, this is the thing to promote.
 */
export function useCustomer(): CustomerSession {
  const [customer, setCustomer] = useState<Customer | null>(null)
  // No stored token means the answer is already known — start resolved so
  // the common case of a first-time visitor never renders a loading state.
  const [loading, setLoading] = useState(() => getStoredCustomerToken() !== null)

  useEffect(() => {
    if (getStoredCustomerToken() === null) return

    let cancelled = false
    void fetchCustomer().then((resolved) => {
      if (cancelled) return
      setCustomer(resolved)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const adopt = useCallback((next: Customer) => {
    setCustomer(next)
    setLoading(false)
  }, [])

  const signOut = useCallback(async () => {
    await logoutCustomer()
    setCustomer(null)
  }, [])

  return { customer, loading, adopt, signOut }
}
