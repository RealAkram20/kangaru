import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import { VehiclesPage } from './VehiclesPage'
import type { Vehicle } from '../types/vehicle'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

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
  post.mockReset()
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

describe('VehiclesPage — selecting several and deleting them', () => {
  const second = vehicle({ id: 2, registration_number: 'UDD 005D' })

  /*
   * A fleet owner, because selection is offered only to somebody who could
   * delete a vehicle one at a time. The suite's default user is a corporate
   * admin who reads the register and manages nothing on it, and rendering
   * these tests as them would assert against a screen that correctly has no
   * checkboxes on it at all.
   */
  const manager = () => makeUser({ role: 'fleet_owner', tenant_id: null, tenant_name: null })

  /** Ticks a row by its registration, via the checkbox that names it. */
  async function tick(registration: string) {
    await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(`select ${registration}`, 'i') }))
  }

  it('offers no bulk bar until something is ticked', async () => {
    fleet([vehicle(), second])
    renderAs(<VehiclesPage />, manager())

    expect(await screen.findByText('UBA 111A')).toBeVisible()

    // A destructive control sitting permanently over the register is one
    // mis-click looking for an occasion.
    expect(screen.queryByRole('button', { name: /delete \d+ selected/i })).toBeNull()

    await tick('UBA 111A')

    expect(screen.getByText('1 vehicle selected')).toBeVisible()
    expect(screen.getByRole('button', { name: /delete 1 selected vehicle/i })).toBeVisible()
  })

  it('sends every ticked id in one request, not one request each', async () => {
    /*
     * The whole reason this is an endpoint rather than a loop of DELETEs: a
     * loop half-succeeds and leaves a clerk to work out which half.
     *
     * Mutation check: send the ids one at a time and the single-call
     * assertion fails.
     */
    fleet([vehicle(), second])
    post.mockResolvedValue(apiOk({ deleted: [1, 2] }) as never)

    renderAs(<VehiclesPage />, manager())
    expect(await screen.findByText('UBA 111A')).toBeVisible()

    await tick('UBA 111A')
    await tick('UDD 005D')

    expect(screen.getByText('2 vehicles selected')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /delete 2 selected vehicles/i }))
    await userEvent.click(await screen.findByRole('button', { name: /remove 2 vehicles/i }))

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/vehicles/bulk-delete', { ids: [1, 2] })
  })

  it('keeps the selection and names what was refused, so the clerk can untick it', async () => {
    /*
     * The refusal path is a list, not a message: the server refuses the whole
     * batch and says which vehicle stopped it. Clearing the ticks here would
     * make the clerk rebuild a ten-row selection to remove one of them.
     */
    fleet([vehicle(), second])
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'Nothing was deleted. Some of the vehicles you chose cannot be.', {
        // Grouped by reason, which is the shape the server sends: the
        // sentence once, and the vehicles it applies to under it.
        'Out on a job. It can be deleted once the trip is finished.': ['UDD 005D'],
      }),
    )

    renderAs(<VehiclesPage />, manager())
    expect(await screen.findByText('UBA 111A')).toBeVisible()

    await tick('UBA 111A')
    await tick('UDD 005D')
    await userEvent.click(screen.getByRole('button', { name: /delete 2 selected vehicles/i }))
    await userEvent.click(await screen.findByRole('button', { name: /remove 2 vehicles/i }))

    // The reason is stated once, as a heading, and the vehicle named under
    // it — not one sentence per vehicle, which at this endpoint's ceiling of
    // a hundred would be a dialog nobody reads.
    expect(await screen.findByText(/out on a job/i)).toBeVisible()
    expect(screen.getByText('UDD 005D', { selector: 'div' })).toBeVisible()
    expect(screen.getByText(/nothing was removed/i)).toBeVisible()
  })

  it('will not offer a delete larger than the endpoint accepts', async () => {
    /*
     * Select-all on a fleet of three hundred is one click, and the request it
     * would build is one the server refuses outright. Offering the button and
     * failing afterwards is the worse of the two answers.
     *
     * Mutation check: drop the `disabled` on the bulk delete button and this
     * fails.
     */
    fleet(Array.from({ length: 101 }, (_, i) => vehicle({ id: i + 1, registration_number: `UAA ${100 + i}A` })))
    renderAs(<VehiclesPage />, manager())

    expect(await screen.findByText('UAA 100A')).toBeVisible()

    await userEvent.click(screen.getByRole('checkbox', { name: /select all rows/i }))

    expect(screen.getByText(/too many at once — select up to 100/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /delete 101 selected vehicles/i })).toBeDisabled()
  })

  it('never selects a vehicle the filter is hiding', async () => {
    /*
     * The one that matters. Select-all means "all of these", and the only
     * honest reading of "these" is what the operator can see — a bulk delete
     * whose select-all quietly includes the rows a filter removed is how a
     * fleet loses vehicles nobody chose.
     *
     * Mutation check: select from the unfiltered list instead of the table's
     * own rows and the count below reads 2.
     */
    fleet([vehicle(), vehicle({ id: 2, registration_number: 'UDD 005D', category: 'boda' })])
    renderAs(<VehiclesPage />, manager())

    expect(await screen.findByText('UBA 111A')).toBeVisible()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by category/i }),
      'boda',
    )
    expect(screen.queryByText('UBA 111A')).toBeNull()

    await userEvent.click(screen.getByRole('checkbox', { name: /select all rows/i }))

    expect(screen.getByText('1 vehicle selected')).toBeVisible()
  })

  it('ticks and clears every row from the heading', async () => {
    fleet([vehicle(), second])
    renderAs(<VehiclesPage />, manager())

    expect(await screen.findByText('UBA 111A')).toBeVisible()

    // Select-all covers this table, which is the only thing it may cover:
    // there is no "all matching the filter" here, and a control reaching
    // beyond the screen is how a bulk action deletes something unseen.
    await userEvent.click(screen.getByRole('checkbox', { name: /select all rows/i }))
    expect(screen.getByText('2 vehicles selected')).toBeVisible()

    await userEvent.click(screen.getByRole('checkbox', { name: /clear selection/i }))
    expect(screen.queryByText(/vehicles selected/i)).toBeNull()
  })
})
