import { screen, waitFor, within } from '@testing-library/react'
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

const CATEGORIES = [
  {
    id: 1,
    key: 'boda',
    name: 'Boda boda',
    description: null,
    active: true,
    position: 0,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
  },
  {
    id: 2,
    key: 'sedan',
    name: 'Sedan',
    description: null,
    active: true,
    position: 1,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
  },
]

/**
 * Answers `/vehicle-categories` from the list above and everything else with
 * `other`. A blanket `mockResolvedValue` cannot: it hands the category
 * chooser a list of drivers, every option is dropped as inactive, and a test
 * about filtering by category ends up filtering by nothing.
 */
function getAnswers(other: () => Promise<unknown>) {
  get.mockImplementation((url: string) =>
    (url.includes('/vehicle-categories') ? Promise.resolve(apiOk(CATEGORIES)) : other()) as never,
  )
}

/**
 * "Which drivers are out on a boda this morning."
 *
 * The depot's question is about the *machine*, and a driver has no category
 * of their own — only whatever they are holding — so every assertion here is
 * really about `driver.vehicle.category`, which is why the field had to reach
 * the wire (`DriverResource`) before this screen could ask.
 */
describe('DriversPage — filtering by vehicle category', () => {
  const onBoda = driver({
    id: 1,
    name: 'Boda Rider',
    license_number: 'DL-1',
    vehicle_id: 11,
    owns_vehicle: true,
    vehicle: { id: 11, registration_number: 'UDD 005D', make: 'Bajaj', model: 'Boxer', category: 'boda' },
  })

  const inSedan = driver({
    id: 2,
    name: 'Sedan Driver',
    license_number: 'DL-2',
    vehicle_id: 12,
    vehicle: { id: 12, registration_number: 'UBA 111A', make: 'Toyota', model: 'Corolla', category: 'sedan' },
  })

  const unallocated = driver({ id: 3, name: 'Awaiting Allocation', license_number: 'DL-3' })

  it('shows only the drivers holding that category', async () => {
    getAnswers(() => Promise.resolve(apiOk([onBoda, inSedan, unallocated])))

    renderAs(<DriversPage />)

    expect(await screen.findByText('Sedan Driver')).toBeVisible()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by vehicle category/i }),
      'boda',
    )

    expect(screen.getByText('Boda Rider')).toBeVisible()
    expect(screen.queryByText('Sedan Driver')).toBeNull()
  })

  it('drops a driver with no vehicle rather than counting them in every category', async () => {
    getAnswers(() => Promise.resolve(apiOk([onBoda, unallocated])))

    renderAs(<DriversPage />)

    expect(await screen.findByText('Awaiting Allocation')).toBeVisible()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by vehicle category/i }),
      'boda',
    )

    // The depot allocates theirs per shift, so "is this rider on a boda" has
    // no answer yet. Showing them under every category is the guess that
    // would send a dispatcher looking for a machine nobody is on.
    expect(screen.queryByText('Awaiting Allocation')).toBeNull()
  })

  it('narrows the text filter within the category rather than beside it', async () => {
    const otherBoda = driver({
      id: 4,
      name: 'Second Rider',
      license_number: 'DL-4',
      vehicle_id: 13,
      vehicle: { id: 13, registration_number: 'UEE 222E', make: 'TVS', model: 'HLX', category: 'boda' },
    })

    // The sedan driver shares the word being typed. That is the whole point
    // of the fixture: a term matching somebody on both sides of the category
    // line is the only way to tell "narrowed within" from "or-ed beside".
    const secondSedan = driver({
      id: 5,
      name: 'Second Sedan',
      license_number: 'DL-5',
      vehicle_id: 14,
      vehicle: { id: 14, registration_number: 'UFF 333F', make: 'Bajaj', model: 'Qute', category: 'sedan' },
    })

    getAnswers(() => Promise.resolve(apiOk([onBoda, secondSedan, otherBoda])))

    renderAs(<DriversPage />)

    expect(await screen.findByText('Second Rider')).toBeVisible()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by vehicle category/i }),
      'boda',
    )
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'Second')

    // Two filters, one result set. Or-ing them would put the sedan back on
    // screen the moment somebody typed.
    expect(screen.getByText('Second Rider')).toBeVisible()
    expect(screen.queryByText('Boda Rider')).toBeNull()
    expect(screen.queryByText('Second Sedan')).toBeNull()
  })

  it("names the category on the row, in the office's own word for it", async () => {
    getAnswers(() => Promise.resolve(apiOk([onBoda])))

    renderAs(<DriversPage />)

    // The stored key is `boda`; the office calls it "Boda boda". A screen
    // showing the key is showing a database value to a dispatcher.
    //
    // Scoped to the row on purpose: the chooser carries the same words, so
    // an unscoped match would pass on the filter alone and never notice the
    // row had gone back to saying `boda` — or saying nothing.
    const row = (await screen.findByText('UDD 005D')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Boda boda')).toBeVisible()
  })
})
