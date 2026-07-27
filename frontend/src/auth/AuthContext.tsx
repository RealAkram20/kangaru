import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { apiClient, clearStoredToken, getStoredToken, storeToken } from '../lib/apiClient'
import type { ApiSuccess } from '../types/api'
import type { User } from '../types/auth'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components -- context object, not a component
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
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
      .then((response) => setUser(response.data.data))
      .catch(() => clearStoredToken())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<ApiSuccess<{ user: User; token: string }>>('/auth/login', {
      email,
      password,
    })
    storeToken(response.data.data.token)
    setUser(response.data.data.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout')
    } finally {
      clearStoredToken()
      setUser(null)
    }
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}
