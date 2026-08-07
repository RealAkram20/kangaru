import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../../test/harness'
import type { Zone } from '../../types/zone'
import { RateCardVersionDialog } from './RateCardVersionDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

function zone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 7,
    tenant_id: null,
    name: 'Central Kampala',
    kind: 'pricing',
    boundary: [
      { lat: 0.28, lng: 32.53 },
      { lat: 0.28, lng: 32.64 },
      { lat: 0.39, lng: 32.64 },
      { lat: 0.39, lng: 32.53 },
    ],
    priority: 50,
    active: true,
    notes: null,
    created_at: '2026-08-07T08:00:00.000000Z',
    updated_at: '2026-08-07T08:00:00.000000Z',
    ...overrides,
  }
}

beforeEach(() => {
  get.mockReset()
  post.mockReset()
})

/** The zone-price row's controls, which carry no labels after the first row. */
function zonePriceRow() {
  return screen.getByLabelText(/Remove zone price 1 for sedan/).closest('div') as HTMLElement
}

it('sends zone prices nested under the vehicle category they override', async () => {
  get.mockResolvedValue(apiOk([zone()]))
  post.mockResolvedValue(apiOk({ id: 1, name: 'Corporate Standard' }))

  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={null} onClose={vi.fn()} onSaved={vi.fn()} />)

  await user.type(screen.getByLabelText(/Card name/), 'Corporate Standard')

  // The default price for a sedan, anywhere.
  const categoryRow = screen.getByLabelText(/Remove sedan/).closest('div') as HTMLElement
  await user.type(within(categoryRow).getByLabelText('Base fare'), '5000')
  await user.type(within(categoryRow).getByLabelText('Per km'), '500')

  await user.click(await screen.findByRole('button', { name: /Add zone price/ }))

  const zoneRow = zonePriceRow()
  await user.type(within(zoneRow).getByLabelText('Base fare'), '8000')
  await user.type(within(zoneRow).getByLabelText('Per km'), '700')

  await user.click(screen.getByRole('button', { name: 'Create rate card' }))

  await waitFor(() => expect(post).toHaveBeenCalled())

  const body = post.mock.calls[0][1] as {
    version: { rates: { vehicle_category: string; zone_rates: { zone_id: number }[] }[] }
  }

  // Nested, not flat. A zone price cannot exist without the default it
  // overrides, and the payload says so structurally rather than by
  // convention — the backend attaches it to `rate_card_rate_id`.
  expect(body.version.rates).toHaveLength(1)
  expect(body.version.rates[0]).toMatchObject({
    vehicle_category: 'sedan',
    base_fare_minor: 5_000,
    per_km_minor: 500,
    zone_rates: [
      {
        zone_id: 7,
        base_fare_minor: 8_000,
        per_km_minor: 700,
        // A blank maximum is uncapped, never "capped at zero" — the same
        // distinction the default rate makes.
        maximum_charge_minor: null,
      },
    ],
  })
})

it('offers only the zones a rate card may actually be priced in', async () => {
  // Mirrors StoreRateCardVersionRequest::priceableZones(). A depot boundary
  // and a switched-off zone are never returned by ZoneResolver::pricingZoneAt,
  // so a price attached to either would be stored and used by no invoice.
  // Offering them would make the 422 the first anybody hears of it.
  get.mockResolvedValue(
    apiOk([
      zone(),
      zone({ id: 8, name: 'Bank campus', kind: 'client', tenant_id: 1, priority: 10 }),
      zone({ id: 9, name: 'Nakawa depot', kind: 'depot' }),
      zone({ id: 10, name: 'Retired band', active: false }),
    ]),
  )

  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={null} onClose={vi.fn()} onSaved={vi.fn()} />)

  await user.click(await screen.findByRole('button', { name: /Add zone price/ }))

  const options = within(zonePriceRow()).getByLabelText('Zone').querySelectorAll('option')
  const names = Array.from(options).map((o) => o.textContent)

  expect(names).toEqual(['Central Kampala', 'Bank campus'])
})

it('still lets prices be set when zones cannot be read at all', async () => {
  // A role without `zones.view`, or a network blip. Zones refine a rate
  // card; they are not a prerequisite for having one, and a finance officer
  // blocked from setting ordinary prices by an optional lookup would be a
  // worse outcome than an unexplained absence.
  get.mockRejectedValue(apiFailure(403, 'FORBIDDEN', 'This action is unauthorized.'))
  post.mockResolvedValue(apiOk({ id: 1, name: 'Corporate Standard' }))

  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={null} onClose={vi.fn()} onSaved={vi.fn()} />)

  expect(await screen.findByText(/No pricing zones have been drawn yet/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Add zone price/ })).toBeDisabled()

  await user.type(screen.getByLabelText(/Card name/), 'Corporate Standard')
  await user.click(screen.getByRole('button', { name: 'Create rate card' }))

  await waitFor(() => expect(post).toHaveBeenCalled())
})

it('refuses to submit while one zone is priced twice for a category', async () => {
  get.mockResolvedValue(apiOk([zone(), zone({ id: 8, name: 'Bank campus', kind: 'client' })]))

  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={null} onClose={vi.fn()} onSaved={vi.fn()} />)

  await user.type(screen.getByLabelText(/Card name/), 'Corporate Standard')

  await user.click(await screen.findByRole('button', { name: /Add zone price/ }))
  await user.click(screen.getByRole('button', { name: /Add zone price/ }))

  // The second row defaults to the next unused zone, so make it collide.
  const second = screen.getByLabelText(/Remove zone price 2 for sedan/).closest('div') as HTMLElement
  await user.selectOptions(within(second).getByLabelText('Zone'), '7')

  expect(screen.getByText('A zone is priced twice')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create rate card' })).toBeDisabled()
  expect(post).not.toHaveBeenCalled()
})

it('shows a rejected zone price against the row that carries it', async () => {
  get.mockResolvedValue(apiOk([zone()]))
  post.mockRejectedValue(
    apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
      'version.rates.0.zone_rates.0.zone_id': [
        'That zone is not available for pricing. Choose an active pricing or client zone.',
      ],
    }),
  )

  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={null} onClose={vi.fn()} onSaved={vi.fn()} />)

  await user.type(screen.getByLabelText(/Card name/), 'Corporate Standard')
  await user.click(await screen.findByRole('button', { name: /Add zone price/ }))
  await user.click(screen.getByRole('button', { name: 'Create rate card' }))

  // The server names a nested field; it has to land on the control the user
  // can see and change, not at the top of the dialog as an opaque failure.
  expect(
    await within(zonePriceRow()).findByText(/That zone is not available for pricing/),
  ).toBeInTheDocument()
})
