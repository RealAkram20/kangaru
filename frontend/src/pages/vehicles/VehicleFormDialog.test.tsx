import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, renderAs } from '../../test/harness'
import { VehicleFormDialog } from './VehicleFormDialog'
import type { Vehicle } from '../../types/vehicle'
import type { VehicleCategory } from '../../types/vehicleCategory'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)

function category(overrides: Partial<VehicleCategory> = {}): VehicleCategory {
  return {
    id: 1,
    key: 'sedan',
    name: 'Sedan',
    description: null,
    active: true,
    position: 0,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

const CATEGORIES = [
  category({ id: 1, key: 'boda', name: 'Boda', position: 0 }),
  category({ id: 2, key: 'sedan', name: 'Sedan', position: 1 }),
  category({ id: 3, key: 'tricycle', name: 'Tricycle', position: 2, active: false }),
]

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    registration_number: 'UAA 111A',
    make: 'Toyota',
    model: 'Premio',
    year: 2015,
    category: 'sedan',
    seating_capacity: 4,
    color: 'Silver',
    vin: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

function open(props: Partial<Parameters<typeof VehicleFormDialog>[0]> = {}) {
  return renderAs(
    <VehicleFormDialog
      vehicle={null}
      categories={CATEGORIES}
      categoriesError={null}
      onClose={() => {}}
      onSaved={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * ADR-0050 — the vehicle form the console has never had.
 *
 * The assertions that matter are about the **category select**, because that
 * is where the platform's two failures both happened: a hand-mirrored list
 * that omitted `boda` on a boda fleet, and the possibility of a retired
 * category silently changing which category a saved vehicle carries.
 */
describe('VehicleFormDialog — categories', () => {
  it('offers every category the fleet currently runs, boda included', async () => {
    open()

    const select = screen.getByLabelText(/category/i)
    // A count, not a `toContain` on one name: the bug this replaces was a
    // list that was *short*, and an existence assertion on "Sedan" would
    // have passed against every one of the drifted copies.
    expect(select.querySelectorAll('option')).toHaveLength(
      // Boda, Sedan, and the placeholder. Tricycle is retired and absent.
      3,
    )
    expect(screen.getByRole('option', { name: 'Boda' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /tricycle/i })).not.toBeInTheDocument()
  })

  it('nominates nothing, so a category is given rather than accepted', () => {
    open()

    // Defaulting to the first option makes "Boda" an answer a clerk has to
    // notice is wrong. The empty value is what makes Save stay disabled.
    expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('button', { name: /register vehicle/i })).toBeDisabled()
  })

  it('keeps a retired category on the vehicle that already carries it', () => {
    open({ vehicle: vehicle({ category: 'tricycle' }) })

    // Without this, the select's value matches no option and the browser
    // renders the **first** one — so a clerk opening a tricycle to fix its
    // colour would see "Boda", and saving would write it.
    expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('tricycle')
    expect(screen.getByRole('option', { name: /tricycle \(retired\)/i })).toBeInTheDocument()
  })

  it('refuses to guess when the categories could not be loaded', () => {
    open({ categories: [], categoriesError: 'Could not load vehicle categories.' })

    expect(screen.getByText(/categories unavailable/i)).toBeInTheDocument()
    // Disabled rather than offering a stale nine. The office can retire a
    // category, so a hard-coded fallback offers choices the server refuses.
    expect(screen.getByLabelText(/category/i)).toBeDisabled()
  })
})

describe('VehicleFormDialog — saving', () => {
  it('registers a vehicle', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ data: {} })
    const onSaved = vi.fn()

    open({ onSaved })

    await user.type(screen.getByLabelText(/registration number/i), 'UBB 900T')
    await user.type(screen.getByLabelText(/^make/i), 'TVS')
    await user.type(screen.getByLabelText(/^model/i), 'King')
    await user.type(screen.getByLabelText(/^year/i), '2021')
    await user.selectOptions(screen.getByLabelText(/category/i), 'boda')
    await user.type(screen.getByLabelText(/^seats/i), '1')

    await user.click(screen.getByRole('button', { name: /register vehicle/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][0]).toBe('/vehicles')
    expect(post.mock.calls[0][1]).toMatchObject({
      registration_number: 'UBB 900T',
      category: 'boda',
      year: 2021,
      seating_capacity: 1,
      // Blank optional fields are null, not '' — the column stores "not
      // recorded", which is a different claim from an empty string.
      color: null,
      vin: null,
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('PATCHes an edit rather than posting a second vehicle', async () => {
    const user = userEvent.setup()
    patch.mockResolvedValue({ data: {} })

    open({ vehicle: vehicle() })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    expect(patch.mock.calls[0][0]).toBe('/vehicles/7')
    expect(post).not.toHaveBeenCalled()
  })

  it('puts a duplicate plate on the field that owns it', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        registration_number: ['The registration number has already been taken.'],
      }),
    )

    open()

    await user.type(screen.getByLabelText(/registration number/i), 'UAA 111A')
    await user.type(screen.getByLabelText(/^make/i), 'Toyota')
    await user.type(screen.getByLabelText(/^model/i), 'Premio')
    await user.type(screen.getByLabelText(/^year/i), '2015')
    await user.selectOptions(screen.getByLabelText(/category/i), 'sedan')
    await user.type(screen.getByLabelText(/^seats/i), '4')
    await user.click(screen.getByRole('button', { name: /register vehicle/i }))

    expect(
      await screen.findByText(/registration number has already been taken/i),
    ).toBeInTheDocument()
  })

  it('shows a 403 as a banner, because no single field is at fault', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(403, 'FORBIDDEN', 'You do not have permission to perform this action.'),
    )

    open()

    await user.type(screen.getByLabelText(/registration number/i), 'UBB 900T')
    await user.type(screen.getByLabelText(/^make/i), 'TVS')
    await user.type(screen.getByLabelText(/^model/i), 'King')
    await user.type(screen.getByLabelText(/^year/i), '2021')
    await user.selectOptions(screen.getByLabelText(/category/i), 'boda')
    await user.type(screen.getByLabelText(/^seats/i), '1')
    await user.click(screen.getByRole('button', { name: /register vehicle/i }))

    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument()
  })
})
