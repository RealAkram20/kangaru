import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiOk, apiFailure, renderAs } from '../test/harness'
import { DriversPage } from './DriversPage'
import type { Driver } from '../types/driver'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const del = vi.mocked(apiClient.delete)

function driver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 3,
    name: 'Ada Nakato',
    phone: '+256700999888',
    email: null,
    license_number: 'DL-99881',
    license_expiry: '2028-01-01',
    status: 'active',
    // ADR-0048 §7. Both are required on the wire: `DriverResource` sends them
    // unconditionally, so a fixture that omits them is a fixture testing a
    // response shape the server does not produce.
    vehicle_id: null,
    owns_vehicle: false,
    account: null,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * ADR-0016 on the screen. The gap it closed survived as long as it did
 * partly because nothing here ever said whether a driver could sign in —
 * so the first assertion is that the answer is now visible at a glance,
 * for every driver, including the ones who cannot.
 */
describe('DriversPage — sign-in', () => {
  it('says which drivers cannot sign in, which nothing used to', async () => {
    get.mockResolvedValue(
      apiOk([
        driver({ id: 1, name: 'Without' }),
        driver({
          id: 2,
          name: 'With',
          account: { id: 9, email: 'with@kangaruride.test', role: 'driver', status: 'active' },
        }),
      ]),
    )

    renderAs(<DriversPage />)

    expect(await screen.findByText('No account')).toBeVisible()
    expect(screen.getByText('Can sign in')).toBeVisible()
  })

  it('creates the sign-in and reloads, so the row stops saying No account', async () => {
    get.mockResolvedValue(apiOk([driver()]))
    // The server's answer changes because of the POST, not because of how
    // many times the page happened to fetch — `mockResolvedValueOnce`
    // twice would be consumed by StrictMode's double-invoked effect before
    // the click ever happened.
    post.mockImplementation(async () => {
      get.mockResolvedValue(
        apiOk([
          driver({
            account: { id: 9, email: 'ada@kangaruride.test', role: 'driver', status: 'active' },
          }),
        ]),
      )
      return apiOk(null)
    })

    renderAs(<DriversPage />)

    await userEvent.click(await screen.findByRole('button', { name: /give sign-in/i }))
    await userEvent.type(screen.getByLabelText(/^Email/), 'ada@kangaruride.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'a-very-long-passphrase')
    await userEvent.click(screen.getByRole('button', { name: /create sign-in/i }))

    expect(post).toHaveBeenCalledWith('/drivers/3/account', {
      email: 'ada@kangaruride.test',
      password: 'a-very-long-passphrase',
    })

    expect(await screen.findByText('Can sign in')).toBeVisible()
  })

  it('puts a server-side field error on the field it belongs to', async () => {
    get.mockResolvedValue(apiOk([driver()]))
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        email: ['That email is already taken.'],
      }),
    )

    renderAs(<DriversPage />)

    await userEvent.click(await screen.findByRole('button', { name: /give sign-in/i }))
    await userEvent.type(screen.getByLabelText(/^Email/), 'taken@kangaruride.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'a-very-long-passphrase')
    await userEvent.click(screen.getByRole('button', { name: /create sign-in/i }))

    expect(await screen.findByText('That email is already taken.')).toBeVisible()
    // Still on the form: a taken address is a correctable mistake.
    expect(screen.getByLabelText(/^Email/)).toBeVisible()
  })

  it('warns that removing a sign-in ends the session on the phone', async () => {
    get.mockResolvedValue(
      apiOk([
        driver({
          account: { id: 9, email: 'ada@kangaruride.test', role: 'driver', status: 'active' },
        }),
      ]),
    )
    del.mockResolvedValue(apiOk(null))

    renderAs(<DriversPage />)

    await userEvent.click(await screen.findByRole('button', { name: /manage sign-in/i }))

    // The consequence is not obvious from "remove", and it is the one that
    // matters operationally — a driver mid-trip loses the app.
    expect(screen.getByText(/ends any session they have open right now/i)).toBeVisible()
    expect(screen.getByText('ada@kangaruride.test')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /remove sign-in/i }))

    await waitFor(() => expect(del).toHaveBeenCalledWith('/drivers/3/account'))
  })

  it('shows a suspended account as suspended rather than as able to sign in', async () => {
    get.mockResolvedValue(
      apiOk([
        driver({
          account: { id: 9, email: 'ada@kangaruride.test', role: 'driver', status: 'suspended' },
        }),
      ]),
    )

    renderAs(<DriversPage />)

    // Suspending a driver suspends the login (ADR-0016 §5); a screen that
    // still said "Can sign in" would send a fleet manager hunting the wrong
    // problem when the driver reports the app will not let them in.
    expect(await screen.findByText('Suspended')).toBeVisible()
    expect(screen.queryByText('Can sign in')).toBeNull()
  })
})
