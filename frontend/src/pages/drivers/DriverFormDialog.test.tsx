import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../../test/harness'
import { DriverFormDialog } from './DriverFormDialog'
import type { Driver } from '../../types/driver'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)

function driver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 3,
    name: 'Ada Nakato',
    phone: '+256700999888',
    email: null,
    license_number: 'DL-99881',
    license_expiry: '2028-01-01',
    status: 'active',
    vehicle_id: null,
    owns_vehicle: false,
    account: null,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

const FLEET = [
  {
    id: 7,
    registration_number: 'UBH 887Y',
    make: 'Toyota',
    model: 'Hiace',
    year: 2016,
    category: 'van' as const,
    seating_capacity: 12,
    color: 'White',
    vin: null,
    status: 'active' as const,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue(apiOk(FLEET))
})

/**
 * ADR-0048 §8 — the screen this console has never had.
 *
 * `DriverController::store` has existed since Phase 1 and nothing ever called
 * it, so every driver in every environment arrived from a seeder. These tests
 * defend the part that is genuinely new: the ownership question, and the
 * vehicle registered without leaving the form.
 */
describe('DriverFormDialog', () => {
  it('creates a driver and their own vehicle in one submission', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue(apiOk(driver()))
    const onSaved = vi.fn()

    renderAs(
      <DriverFormDialog driver={null} onClose={() => {}} onSaved={onSaved} />,
      makeUser({ role: 'super_admin' }),
    )

    await user.type(screen.getByLabelText(/full name/i), 'Musa Kirya')
    await user.type(screen.getByLabelText(/^phone/i), '+256772123456')
    await user.type(screen.getByLabelText(/licence number/i), 'UG-DL-40021')
    await user.type(screen.getByLabelText(/licence expiry/i), '2029-04-01')

    await user.click(screen.getByLabelText(/owns their vehicle/i))
    await user.type(screen.getByLabelText(/number plate/i), 'uax 123x')
    await user.type(screen.getByLabelText(/^make/i), 'Toyota')
    await user.type(screen.getByLabelText(/^model/i), 'Premio')
    await user.type(screen.getByLabelText(/^year/i), '2014')

    await user.click(screen.getByRole('button', { name: /create driver/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>]
    expect(path).toBe('/drivers')
    expect(body.owns_vehicle).toBe(true)

    // One request, carrying both halves — the whole point of ADR-0048 §8.
    // Two requests would be the abandoned half-finished state it exists to
    // prevent, moved from the clerk's screen into the network tab.
    expect(body.vehicle).toMatchObject({
      // Uppercased on the way in: a plate is read back against a vehicle in a
      // yard, and "uax 123x" is a different string to the index.
      registration_number: 'UAX 123X',
      make: 'Toyota',
      model: 'Premio',
      year: 2014,
    })
    expect(body.vehicle_id).toBeUndefined()

    expect(onSaved).toHaveBeenCalled()
  })

  it('does not offer the registration form until ownership is ticked', async () => {
    const user = userEvent.setup()

    renderAs(
      <DriverFormDialog driver={null} onClose={() => {}} onSaved={() => {}} />,
      makeUser({ role: 'super_admin' }),
    )

    /**
     * **The regression this exists for.**
     *
     * The form opened on "Register their vehicle" for every new driver, above
     * an unticked ownership box — eight fields the server answers 422 to,
     * because `ValidatesInlineVehicle` refuses to register a vehicle for a
     * driver not marked as owning one.
     *
     * Every other test in this file ticked the box first, so none of them
     * could see it. Opening the screen in a browser found it in one look.
     */
    expect(await screen.findByRole('combobox', { name: /vehicle/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/number plate/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/owns their vehicle/i))
    expect(await screen.findByLabelText(/number plate/i)).toBeInTheDocument()

    // And un-ticking withdraws it again, rather than leaving a form whose two
    // halves disagree.
    await user.click(screen.getByLabelText(/owns their vehicle/i))
    expect(screen.queryByLabelText(/number plate/i)).not.toBeInTheDocument()
  })

  it('sends a fleet vehicle rather than a new one when ownership is left unticked', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue(apiOk(driver()))

    renderAs(
      <DriverFormDialog driver={null} onClose={() => {}} onSaved={() => {}} />,
      // A role with no fleet permission, so the form opens on the picker.
      makeUser({ role: 'dispatcher' }),
    )

    await user.type(screen.getByLabelText(/full name/i), 'Ada Nakato')
    await user.type(screen.getByLabelText(/^phone/i), '+256700999888')
    await user.type(screen.getByLabelText(/licence number/i), 'DL-99881')
    await user.type(screen.getByLabelText(/licence expiry/i), '2029-01-01')

    await user.selectOptions(await screen.findByRole('combobox', { name: /vehicle/i }), '7')
    await user.click(screen.getByRole('button', { name: /create driver/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.vehicle_id).toBe(7)
    expect(body.owns_vehicle).toBe(false)
    expect(body.vehicle).toBeUndefined()
  })

  it('offers no inline registration to a role that does not hold the fleet', async () => {
    renderAs(
      <DriverFormDialog driver={null} onClose={() => {}} onSaved={() => {}} />,
      makeUser({ role: 'dispatcher' }),
    )

    // ADR-0048 §9. The server refuses this anyway — proved by a backend test —
    // and offering a form that answers 403 is worse than not offering it.
    expect(await screen.findByRole('combobox', { name: /vehicle/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/number plate/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /register a new one/i })).not.toBeInTheDocument()
    expect(screen.getByText(/needs the fleet permission/i)).toBeInTheDocument()
  })

  it('shows the vehicle already on file rather than a picker aimed at it', async () => {
    renderAs(
      <DriverFormDialog
        driver={driver({ vehicle_id: 7, owns_vehicle: true })}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      makeUser({ role: 'super_admin' }),
    )

    // A pre-filled picker invites a clerk to change the vehicle by accident;
    // the record they already have is not a choice being made.
    expect(await screen.findByText('UBH 887Y')).toBeInTheDocument()
    expect(screen.getByText(/Toyota Hiace/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /vehicle/i })).not.toBeInTheDocument()
  })

  it('patches an edit and never resends what the form did not decide', async () => {
    const user = userEvent.setup()
    patch.mockResolvedValue(apiOk(driver()))

    renderAs(
      <DriverFormDialog
        driver={driver({ vehicle_id: 7, owns_vehicle: true })}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      makeUser({ role: 'super_admin' }),
    )

    await user.click(await screen.findByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    const [path, body] = patch.mock.calls[0] as [string, Record<string, unknown>]

    expect(path).toBe('/drivers/3')
    expect(body.owns_vehicle).toBe(true)
    // The link is preserved, not silently cleared, by an edit that never
    // touched the vehicle section.
    expect(body.vehicle_id).toBe(7)
  })

  it('puts a 422 on the field it belongs to, including the nested vehicle', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          success: false,
          code: 'VALIDATION_FAILED',
          message: 'The given data was invalid.',
          errors: {
            'vehicle.registration_number': ['That number plate is already on a vehicle in the fleet.'],
          },
        },
      },
    })

    renderAs(
      <DriverFormDialog driver={null} onClose={() => {}} onSaved={() => {}} />,
      makeUser({ role: 'super_admin' }),
    )

    await user.click(screen.getByLabelText(/owns their vehicle/i))
    await user.click(screen.getByRole('button', { name: /create driver/i }))

    // Under the plate field, not in a banner at the top: a dotted field path
    // that the form does not map back to its input is an error message about
    // a field the clerk then has to go and find.
    expect(
      await screen.findByText(/already on a vehicle in the fleet/i),
    ).toBeInTheDocument()
  })
})
