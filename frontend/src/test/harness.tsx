import { AxiosError, AxiosHeaders } from 'axios'
import { render } from '@testing-library/react'
import { StrictMode, type ReactElement } from 'react'
import { AuthContext } from '../auth/AuthContext'
import type { User } from '../types/auth'

/**
 * Shared test harness.
 *
 * Two things every page test needs and neither of which should be rebuilt
 * per file: an authenticated user, and a way to make the API fail the way
 * the real one does.
 */

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    tenant_id: 1,
    name: 'Ada Nakato',
    email: 'ada@centenary-bank.test',
    role: 'corporate_admin',
    created_at: '2026-07-01T08:00:00.000000Z',
    ...overrides,
  }
}

/**
 * Renders with an authenticated user, without mounting AuthProvider.
 *
 * AuthProvider hydrates itself from `/auth/me` on mount, so using it would
 * put an unrelated request in front of every assertion and make each test
 * depend on the shape of a response it does not care about. The context
 * value is what the pages actually consume.
 *
 * ## Why StrictMode
 *
 * `main.tsx` wraps the app in it, so the app really does mount, unmount and
 * remount every component and double-invoke every effect in development.
 * Testing Library does not do that by default, and the gap is not
 * theoretical: `useNotifications` shipped with a `busy` ref that swallowed
 * the second invocation and left the page on "Loading…" forever. Every test
 * passed; the browser showed a spinner.
 *
 * Rendering here the way the app renders costs nothing and closes that gap.
 * A component that cannot survive being mounted twice is a component with a
 * bug, and this is where it should surface.
 */
export function renderAs(ui: ReactElement, user: User | null = makeUser()) {
  return render(
    <StrictMode>
      <AuthContext.Provider
        value={{
          user,
          loading: false,
          login: () => Promise.resolve(),
          logout: () => Promise.resolve(),
        }}
      >
        {ui}
      </AuthContext.Provider>
    </StrictMode>,
  )
}

/**
 * An axios rejection carrying the backend's real failure envelope.
 *
 * Built as a genuine AxiosError rather than a plain object, because
 * `apiError()` gates on `axios.isAxiosError()` — a hand-rolled
 * `{ response: { data } }` silently falls through to the NETWORK_ERROR
 * branch, and the test would then assert the fallback message while
 * believing it had asserted the server's.
 *
 * @param errors field-keyed validation messages, for 422s
 */
export function apiFailure(
  status: number,
  code: string,
  message: string,
  errors: Record<string, string[]> = {},
): AxiosError {
  const error = new AxiosError(message, String(status))

  error.response = {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { success: false, code, message, errors },
  }

  return error
}

/** The success envelope every endpoint returns, as axios hands it back. */
export function apiOk<T>(data: T, meta?: unknown) {
  return { data: { success: true, message: '', data, ...(meta === undefined ? {} : { meta }) } }
}
