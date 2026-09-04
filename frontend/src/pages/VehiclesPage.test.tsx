import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiOk, renderAs } from '../test/harness'
import { VehiclesPage } from './VehiclesPage'
import type { Vehicle } from '../types/vehicle'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)

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

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    registration_number: 'UBA 111A',
    make: 'Toyota',
    model: 'Corolla',
    year: 2019,
    category: 'sedan',
    seating_capacity: 4,
    color: null,
    vin: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

/**
 * Answers `/vehicle-categories` from the list above and `/vehicles` from the
 * fleet handed in. A blanket `mockResolvedValue` cannot: it feeds the chooser
 * a list of vehicles, every option is dropped as inactive, and a test about
 * filtering by category ends up filtering by nothing.
 */
function fleet(vehicles: Vehicle[]) {
  get.mockImplementation((url: string) =>
    (url.includes('/vehicle-categories')
      ? Promise.resolve(apiOk(CATEGORIES))
      : Promise.resolve(apiOk(vehicles))) as never,
  )
}

beforeEach(() => {
  get.mockReset()
})

/**
 * "What have we got in boda."
 *
 * The register is one long table and the office's first question of it is
 * almost never a plate — it is a category. Until this existed the only way to
 * ask was to know how the make was spelled.
 */
describe('VehiclesPage — filtering by category', () => {
  const boda = vehicle({ id: 2, registration_number: 'UDD 005D', make: 'Bajaj', model: 'Boxer', category: 'boda' })

  it('shows only the vehicles in the chosen category', async () => {
    fleet([vehicle(), boda])

    renderAs(<VehiclesPage />)

    expect(await screen.findByText('UBA 111A')).toBeVisible()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by category/i }),
      'boda',
    )

    expect(screen.getByText('UDD 005D')).toBeVisible()
    expect(screen.queryByText('UBA 111A')).toBeNull()
  })

  it('narrows the text filter within the category rather than beside it', async () => {
    // The sedan is a Bajaj too. That is the whole point of the fixture: a
    // word that appears on both sides of the category line is the only way
    // to tell "narrowed within" from "or-ed beside".
    const bajajSedan = vehicle({ id: 4, registration_number: 'UFF 333F', make: 'Bajaj', model: 'Qute', category: 'sedan' })

    fleet([bajajSedan, boda, vehicle({ id: 3, registration_number: 'UEE 222E', make: 'TVS', model: 'Boxer', category: 'boda' })])

    renderAs(<VehiclesPage />)

    expect(await screen.findByText('UEE 222E')).toBeVisible()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by category/i }),
      'boda',
    )
    await userEvent.type(screen.getByPlaceholderText(/reg. number, make or model/i), 'Bajaj')

    // Two filters, one result set. Or-ing them would put the sedan back on
    // screen the moment somebody typed.
    expect(screen.getByText('UDD 005D')).toBeVisible()
    expect(screen.queryByText('UEE 222E')).toBeNull()
    expect(screen.queryByText('UFF 333F')).toBeNull()
  })

  it('counts what is on screen once a category is chosen, not the whole fleet', async () => {
    fleet([vehicle(), boda])

    renderAs(<VehiclesPage />)

    expect(await screen.findByText('2 total')).toBeVisible()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by category/i }),
      'boda',
    )

    // A one-row table under "2 total" reads as a register that lost a
    // vehicle. The count has to say what it was cut from, or say nothing.
    expect(screen.getByText('1 of 2')).toBeVisible()
    expect(screen.queryByText('2 total')).toBeNull()
  })

  it('goes back to the whole fleet when the choice is cleared', async () => {
    fleet([vehicle(), boda])

    renderAs(<VehiclesPage />)

    const chooser = await screen.findByRole('combobox', { name: /filter by category/i })

    await userEvent.selectOptions(chooser, 'boda')
    // '' is a real choice, not an unfilled field. A chooser that cannot be
    // undone is a table somebody has to reload the page to escape.
    await userEvent.selectOptions(chooser, '')

    expect(screen.getByText('UBA 111A')).toBeVisible()
    expect(screen.getByText('UDD 005D')).toBeVisible()
  })
})
