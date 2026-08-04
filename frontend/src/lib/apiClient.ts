import axios from 'axios'

const TOKEN_KEY = 'kr_token'

/**
 * Routes that exist for people with no account (ADR-0012 §5). Two rules
 * below key off this list, both protecting the same person — the walk-in
 * visitor who once signed in on this browser, or never did:
 *
 * - a request to a `/public/*` endpoint never carries the stored staff
 *   token, so the anonymous write stays provably anonymous;
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
  // The public endpoints are unauthenticated by design; a bearer token on
  // them is at best noise and at worst a walk-in order silently tied to a
  // staff session.
  if (config.url?.startsWith('/public/')) {
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
