import axios from 'axios'

const TOKEN_KEY = 'kr_token'
/**
 * The customer session lives in its own key, never sharing the staff one.
 * They are different principals against different guards (ADR-0013 §1),
 * and one key would mean a dispatcher signing in on a shared terminal
 * silently inherits — or destroys — the walk-in customer's session.
 */
const CUSTOMER_TOKEN_KEY = 'kr_customer_token'

/**
 * Routes that exist for people with no account (ADR-0012 §5). Two rules
 * below key off this list, both protecting the same person — the walk-in
 * visitor who once signed in on this browser, or never did:
 *
 * - a request to a `/public/*` endpoint never carries the stored staff
 *   token, so a walk-in order is never silently tied to a staff session;
 * - a 401 never redirects a visitor off a public page to the staff login.
 *   The interceptor still clears the stale token, so the app quietly
 *   becomes signed-out instead of bouncing.
 */
const PUBLIC_PATHS = ['/', '/order', '/login']

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    Accept: 'application/json',
  },
})

apiClient.interceptors.request.use((config) => {
  const url = config.url ?? ''

  /*
   * `/public/*` takes the customer token when there is one, and never the
   * staff token.
   *
   * The customer half matters: ADR-0013 §4 says a customer token *may*
   * accompany the public order write, and then the order links to the
   * account. Stripping every Authorization header here — which is what
   * this did before customer sign-up existed — made that branch of
   * PublicOrderRequestController unreachable from this client, so a
   * signed-in customer's orders would have silently filed as anonymous.
   *
   * The staff half is the original rule and still holds: a dispatcher
   * browsing the public order form is not the customer.
   */
  if (url.startsWith('/public/')) {
    const customerToken = localStorage.getItem(CUSTOMER_TOKEN_KEY)
    if (customerToken) {
      config.headers.Authorization = `Bearer ${customerToken}`
    }
    return config
  }

  // The customer surface answers only to a customer token; sending the
  // staff one would be a 401 that logs the dispatcher out of their own app.
  if (url.startsWith('/customer/')) {
    const customerToken = localStorage.getItem(CUSTOMER_TOKEN_KEY)
    if (customerToken) {
      config.headers.Authorization = `Bearer ${customerToken}`
    }
    return config
  }

  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url: string = error.config?.url ?? ''
      // A customer's expired token must not clear the staff session, or
      // send anybody to the staff login — that is not their sign-in page.
      if (url.startsWith('/customer/') || url.startsWith('/public/')) {
        localStorage.removeItem(CUSTOMER_TOKEN_KEY)
        return Promise.reject(error)
      }
      localStorage.removeItem(TOKEN_KEY)
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function getStoredCustomerToken(): string | null {
  return localStorage.getItem(CUSTOMER_TOKEN_KEY)
}

export function storeCustomerToken(token: string): void {
  localStorage.setItem(CUSTOMER_TOKEN_KEY, token)
}

export function clearStoredCustomerToken(): void {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY)
}
