import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, renderAs } from '../../test/harness'
import { VehicleCategoriesPanel } from './VehicleCategoriesPanel'
import type { VehicleCategory } from '../../types/vehicleCategory'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)
const del = vi.mocked(apiClient.delete)

function category(overrides: Partial<VehicleCategory> = {}): VehicleCategory {
  return {
    id: 1,
    key: 'sedan',
    name: 'Sedan',
    description: null,
    active: true,
    position: 0,
    vehicles_count: 0,
    rate_cards_total: 1,
    unpriced_rate_cards: [],
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

function panel(categories: VehicleCategory[], canManage = true) {
  return renderAs(
    <VehicleCategoriesPanel
      categories={categories}
      error={null}
      canManage={canManage}
      onChanged={() => {}}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * ADR-0050 §5 — the sync, as this screen is allowed to say it.
 *
 * A rate card version is immutable, so a category created here is unpriced
 * on every tariff that already exists and nothing on this screen can change
 * that. The assertions below are all about the platform being honest about
 * it: name the cards, never render a price, and offer the one route that
 * actually resolves it.
 */
describe('VehicleCategoriesPanel — the unpriced warning', () => {
  it('names the rate cards that cannot bill a category', () => {
    panel([
      category({ id: 1, key: 'sedan', name: 'Sedan' }),
      category({
        id: 2,
        key: 'van',
        name: 'Van',
        unpriced_rate_cards: [{ id: 7, name: 'Centenary Bank' }],
      }),
    ])

    // The card by name, so a fleet manager knows which one to go to —
    // "not priced somewhere" is a warning people learn to ignore.
    expect(screen.getByText(/not priced on Centenary Bank/i)).toBeInTheDocument()
    expect(screen.getAllByText(/^Priced$/)).toHaveLength(1)
  })

  it('counts the cards rather than listing them, once there is more than one', () => {
    panel([
      category({
        key: 'van',
        name: 'Van',
        rate_cards_total: 3,
        unpriced_rate_cards: [
          { id: 1, name: 'Corporate Standard' },
          // The same name on a second client's card. Rate card names are
          // unique per tenant and a platform admin sees every tenant's, so
          // joining them read "Corporate Standard, Corporate Standard" on
          // the real database — found by opening the screen, because every
          // fixture here had distinct names until this one.
          { id: 2, name: 'Corporate Standard' },
        ],
      }),
    ])

    expect(screen.getAllByText('Not priced on 2 rate cards').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Corporate Standard, Corporate Standard/)).not.toBeInTheDocument()
  })

  it('never renders a price for a category nobody has priced', () => {
    panel([
      category({
        key: 'van',
        name: 'Van',
        unpriced_rate_cards: [{ id: 7, name: 'Centenary Bank' }],
      }),
    ])

    // `docs/screen-rules.md` §1: a zero is not a substitute for unknown, and
    // "UGX 0" on a tariff screen reads as a free ride.
    //
    // Scoped to the pricing cell, deliberately: `vehicles_count` renders a
    // legitimate 0, so an assertion over the whole panel would have to be
    // loosened until it stopped meaning anything.
    // The badges themselves — `getAllByText` because DataTable renders a
    // table and a card list, and the warning legitimately appears in both.
    const badges = screen.getAllByText(/not priced on Centenary Bank/i)

    expect(badges.length).toBeGreaterThan(0)
    for (const badge of badges) {
      expect(badge.textContent).not.toMatch(/UGX|[0-9]/)
    }
  })

  it('says nothing reassuring when there is no active rate card at all', () => {
    panel([category({ key: 'van', name: 'Van', rate_cards_total: 0, unpriced_rate_cards: [] })])

    // "Priced" would be technically true — nothing is missing it — and
    // useless: no tariff exists to bill against. An em dash and a title.
    expect(screen.queryByText(/^Priced$/)).not.toBeInTheDocument()
    expect(screen.getByTitle(/no active rate card/i)).toBeInTheDocument()
  })

  it('sends "Price it" to the version dialog for the card that is missing it', async () => {
    const user = userEvent.setup()
    panel([
      category({
        key: 'van',
        name: 'Van',
        unpriced_rate_cards: [{ id: 7, name: 'Centenary Bank' }],
      }),
    ])

    await user.click(screen.getByRole('button', { name: /price it/i }))

    // The card *and* the category, so the officer lands on a form with the
    // missing row already added rather than hunting for it.
    expect(navigate).toHaveBeenCalledWith('/rate-cards', {
      state: { priceCategory: 'van', cardId: 7 },
    })
  })
})

describe('VehicleCategoriesPanel — deleting and retiring', () => {
  it('turns the server’s 409 into the action that resolves it', async () => {
    const user = userEvent.setup()
    del.mockRejectedValue(
      apiFailure(
        409,
        'VEHICLE_CATEGORY_IN_USE',
        '"Van" cannot be deleted because 3 vehicle(s) still refer to it. Retire it instead.',
      ),
    )
    patch.mockResolvedValue({ data: {} })

    panel([category({ id: 4, key: 'van', name: 'Van', vehicles_count: 3 })])

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /delete category/i }))

    // The refusal names what is holding it…
    expect(await screen.findByText(/3 vehicle\(s\)/)).toBeInTheDocument()
    // …and the destructive button becomes the one that works, rather than
    // sending somebody who has just been refused back to the table.
    const retire = await screen.findByRole('button', { name: /retire it instead/i })
    expect(screen.queryByRole('button', { name: /delete category/i })).not.toBeInTheDocument()

    await user.click(retire)

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    expect(patch.mock.calls[0][0]).toBe('/vehicle-categories/4')
    expect(patch.mock.calls[0][1]).toEqual({ active: false })
  })

  it('deletes outright when nothing holds the category', async () => {
    const user = userEvent.setup()
    del.mockResolvedValue({ data: {} })

    panel([category({ id: 4, key: 'quad_bike', name: 'Quad bike' })])

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /delete category/i }))

    await waitFor(() => expect(del).toHaveBeenCalledWith('/vehicle-categories/4'))
    expect(patch).not.toHaveBeenCalled()
  })
})

describe('VehicleCategoriesPanel — the immutable key', () => {
  it('offers a key on create and suggests it from the name', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ data: {} })

    panel([])

    await user.click(screen.getByRole('button', { name: /new category/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Minibus 14')

    // Typing the key by hand is how `mini_bus` ends up beside `minibus` as
    // two categories forever.
    expect((screen.getByLabelText(/^key/i) as HTMLInputElement).value).toBe('minibus_14')

    await user.click(screen.getByRole('button', { name: /create category/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][1]).toMatchObject({ key: 'minibus_14', name: 'Minibus 14' })
  })

  it('shows the key as read-only text on an edit, and never sends it', async () => {
    const user = userEvent.setup()
    patch.mockResolvedValue({ data: {} })

    panel([category({ id: 4, key: 'suv', name: 'SUV' })])

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    // Not a disabled input — there is no field at all, because there is no
    // version of this request the platform will ever carry out. An issued
    // invoice line stores the key.
    expect(screen.queryByLabelText(/^key/i)).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText(/^name/i))
    await user.type(screen.getByLabelText(/^name/i), 'Sport utility')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    expect(patch.mock.calls[0][1]).not.toHaveProperty('key')
    expect(patch.mock.calls[0][1]).toMatchObject({ name: 'Sport utility' })
  })
})

describe('VehicleCategoriesPanel — permissions', () => {
  it('offers no way to change anything to somebody who may only read', () => {
    panel([category({ key: 'van', name: 'Van' })], false)

    // The list is still useful — it is what the fleet runs — but every
    // control the server would refuse is absent rather than disabled.
    expect(screen.getByText('Van')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new category/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^retire$/i })).not.toBeInTheDocument()
  })

  it('shows a retired category as retired, in words and not only in colour', () => {
    panel([category({ key: 'tricycle', name: 'Tricycle', active: false })])

    // DESIGN.md §8: status is never carried by colour alone.
    const row = screen.getByText('Tricycle').closest('tr') ?? document.body
    expect(within(row as HTMLElement).getByText('Retired')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /offer again/i })).toBeInTheDocument()
  })
})
