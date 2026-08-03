import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { apiClient, clearStoredToken, getStoredToken, storeToken } from '../lib/apiClient'
import type { ApiSuccess } from '../types/api'
import type { User } from '../types/auth'

/**
 * What a password alone earned (ADR-0008).
 *
 * `signed-in` is the whole of the old behaviour. The other two are the
 * states a two-step login introduces, and they are returned rather than
 * handled here because only the screen knows what to render next.
 */
export type LoginOutcome =
  /** A token was issued and `user` is populated. */
  | { status: 'signed-in' }
  /**
   * The password was right and no token exists yet — decision 2, "a partial
   * token is a token". The caller collects a code and calls `verifyMfa`.
   */
  | { status: 'mfa-required'; challengeId: string }
  /**
   * A token was issued, and it opens nothing but enrolment (decision 3).
   * The caller sends the user to set up an authenticator.
   */
  | { status: 'must-enrol-mfa' }

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<LoginOutcome>
  verifyMfa: (challengeId: string, code: string) => Promise<LoginOutcome>
  logout: () => Promise<void>
  /**
   * True while the signed-in user must enrol before they can do anything.
   * Read from the server on every `/auth/me`, never inferred from the role
   * — the client holding its own copy of which roles need a factor is the
   * drift ADR-0004 and ADR-0006 both exist to avoid.
   */
  mustEnrolMfa: boolean
  /** Called by the enrolment screen once a factor is confirmed. */
  markMfaEnrolled: () => void
  /**
   * Re-reads `/auth/me` and replaces `user`. For screens that change the
   * account they are showing — enrolling or removing a second factor — so
   * `mfa_enabled` and friends come back as the server's answer rather than
   * a local guess patched over stale state.
   */
  refreshUser: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components -- context object, not a component
export const AuthContext = createContext<AuthContextValue | null>(null)

/** The 202 body: a claim ticket, and nothing that authenticates a request. */
interface MfaChallengeBody {
  challenge_id?: string
  method?: string
}

interface SignInBody {
  user: User
  token: string
  must_enrol_mfa?: boolean
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [mustEnrolMfa, setMustEnrolMfa] = useState(false)
  // Lazy init so there's nothing to synchronously set in the effect below
  // when there's no stored token — only the genuinely async fetch path
  // (hydrating `user` from /auth/me) needs to flip `loading` off later.
  const [loading, setLoading] = useState(() => Boolean(getStoredToken()))

  useEffect(() => {
    if (!getStoredToken()) {
      return
    }

    apiClient
      .get<ApiSuccess<User>>('/auth/me')
      .then((response) => {
        setUser(response.data.data)
        // Rehydrated on every reload, so a user who refreshes mid-enrolment
        // lands back in the enrolment flow rather than on a dashboard that
        // answers 403 to everything it tries to load.
        setMustEnrolMfa(Boolean(response.data.data.must_enrol_mfa))
      })
      .catch(() => clearStoredToken())
      .finally(() => setLoading(false))
  }, [])

  /**
   * Applies a successful sign-in, whichever step produced it.
   *
   * Shared between `login` and `verifyMfa` because the two differ only in
   * how the token was earned; storing it and hydrating the user is
   * identical, and writing it twice is how the two drift.
   */
  const acceptSignIn = useCallback((body: SignInBody): LoginOutcome => {
    storeToken(body.token)
    setUser(body.user)
    setMustEnrolMfa(Boolean(body.must_enrol_mfa))

    return body.must_enrol_mfa ? { status: 'must-enrol-mfa' } : { status: 'signed-in' }
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const response = await apiClient.post<ApiSuccess<SignInBody & MfaChallengeBody>>(
        '/auth/login',
        { email, password },
      )

      // 202: the password was accepted and the login is not finished.
      // Detected on the challenge rather than the status code so a proxy
      // that rewrites 202 to 200 cannot silently drop the second factor.
      const challengeId = response.data.data.challenge_id

      if (challengeId) {
        return { status: 'mfa-required', challengeId }
      }

      return acceptSignIn(response.data.data)
    },
    [acceptSignIn],
  )

  const verifyMfa = useCallback(
    async (challengeId: string, code: string): Promise<LoginOutcome> => {
      const response = await apiClient.post<ApiSuccess<SignInBody>>('/auth/mfa/verify', {
        challenge_id: challengeId,
        code,
      })

      return acceptSignIn(response.data.data)
    },
    [acceptSignIn],
  )

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout')
    } finally {
      clearStoredToken()
      setUser(null)
      setMustEnrolMfa(false)
    }
  }, [])

  const markMfaEnrolled = useCallback(() => setMustEnrolMfa(false), [])

  const refreshUser = useCallback(async () => {
    const response = await apiClient.get<ApiSuccess<User>>('/auth/me')
    setUser(response.data.data)
    setMustEnrolMfa(Boolean(response.data.data.must_enrol_mfa))
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, loading, login, verifyMfa, logout, mustEnrolMfa, markMfaEnrolled, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}
