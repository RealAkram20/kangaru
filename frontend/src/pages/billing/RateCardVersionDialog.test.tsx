import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../../test/harness'
import type { Zone } from '../../types/zone'
import { RateCardVersionDialog } from './RateCardVersionDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)

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
  patch.mockReset()
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

/**
 * **Adding a version opens prefilled with the current prices.**
 *
 * The owner asked to be able to edit rate cards. Prices are immutable, so the
 * honest form of that request is: start from what the prices are now, change
 * the figures, save a new version. Making a finance officer retype six vehicle
 * categories to change one number is how a typo gets into a tariff.
 *
 * Nothing about immutability moves — the copied version is untouched, and what
 * is submitted is an ordinary create.
 */
it('opens a new version prefilled from the card’s current prices', async () => {
  get.mockResolvedValue(apiOk([]))

  const card = {
    id: 3,
    name: 'Public tariff',
    description: null,
    status: 'active',
    is_default: true,
    versions: [
      {
        id: 7,
        version: 2,
        effective_from: '2026-08-15',
        currency: 'UGX',
        rounding_mode: 'half_up',
        rounding_mode_label: 'Half up',
        free_waiting_minutes: 3,
        night_starts_at: null,
        night_ends_at: null,
        night_multiplier_bp: 10_000,
        is_locked: false,
        notes: null,
        rates: [
          {
            vehicle_category: 'boda',
            base_fare_minor: 2_000,
            per_km_minor: 1_000,
            per_waiting_minute_minor: 200,
            minimum_charge_minor: 3_000,
            maximum_charge_minor: 150_000,
            zone_rates: [],
          },
        ],
      },
    ],
  }

  renderAs(
    <RateCardVersionDialog card={card as never} onClose={vi.fn()} onSaved={vi.fn()} />,
  )

  await waitFor(() => expect(screen.getByDisplayValue('2000')).toBeInTheDocument())

  expect(screen.getByDisplayValue('1000')).toBeInTheDocument()
  expect(screen.getByDisplayValue('200')).toBeInTheDocument()
  expect(screen.getByDisplayValue('3000')).toBeInTheDocument()
  expect(screen.getByDisplayValue('150000')).toBeInTheDocument()

  // The version's own settings come with it, or a finance officer changing one
  // price silently resets the free waiting allowance to zero — a change to
  // what every passenger is charged, made by accident.
  expect(screen.getByDisplayValue('3')).toBeInTheDocument()
})

it('prefills an uncapped maximum as blank, never as zero', async () => {
  get.mockResolvedValue(apiOk([]))

  const card = {
    id: 3,
    name: 'Public tariff',
    description: null,
    status: 'active',
    is_default: true,
    versions: [
      {
        id: 7,
        version: 1,
        effective_from: '2026-08-15',
        currency: 'UGX',
        rounding_mode: 'half_up',
        rounding_mode_label: 'Half up',
        free_waiting_minutes: 3,
        night_starts_at: null,
        night_ends_at: null,
        night_multiplier_bp: 10_000,
        is_locked: false,
        notes: null,
        rates: [
          {
            vehicle_category: 'boda',
            base_fare_minor: 2_000,
            per_km_minor: 1_000,
            per_waiting_minute_minor: 200,
            minimum_charge_minor: 3_000,
            // Uncapped, which is every rate row on this platform today.
            maximum_charge_minor: null,
            zone_rates: [],
          },
        ],
      },
    ],
  }

  renderAs(<RateCardVersionDialog card={card as never} onClose={vi.fn()} onSaved={vi.fn()} />)

  await waitFor(() => expect(screen.getByDisplayValue('2000')).toBeInTheDocument())

  /*
   * **Blank, not "0".** The two are opposite claims here: blank means
   * uncapped and `toMinor` turns it back into null on submit, while "0" means
   * capped at nothing — every trip on this category free.
   *
   * This case exists because a mutation survived without it. The first version
   * of the prefill test used a rate with a maximum set, so `amountToDraft`'s
   * null branch was never exercised, and replacing it with `String(value ?? 0)`
   * passed the whole suite while silently zero-capping a tariff.
   */
  // `.value`, not `toHaveValue`: these are number inputs, and jsdom reports an
  // empty one as `null` rather than `''`, which makes the assertion read as if
  // the element were missing.
  const maximums = screen.getAllByLabelText(/Maximum/) as HTMLInputElement[]

  expect(maximums[0]!.value).toBe('')
})

it('opens blank for a card with no versions, rather than crashing', async () => {
  get.mockResolvedValue(apiOk([]))

  const bare = { id: 9, name: 'Empty', description: null, status: 'active', is_default: false, versions: [] }

  renderAs(<RateCardVersionDialog card={bare as never} onClose={vi.fn()} onSaved={vi.fn()} />)

  // Falls back to the single empty sedan row the dialog has always started
  // with. `versions` is optional on the type and a card genuinely can have
  // none — that was the state the whole listing bug rendered as.
  await waitFor(() => expect(screen.getByText(/sedan/i)).toBeInTheDocument())
})

/**
 * Editing a card is now the same form it was created with, and **Save does the
 * minimum writes the change actually needs.**
 *
 * The immutability rule used to be enforced by the shape of the UI — a small
 * "details" dialog beside a big "prices" one. The owner put the two side by
 * side and said the edit was a different thing from the create; it was, and the
 * rule belonged in what Save does rather than in how many dialogs there are.
 *
 * These cases pin the three outcomes, and the first is the one that matters:
 * a rename must not add a version, or a card's pricing history fills with
 * entries that changed no price and nobody can read a real change out of it.
 */
function tariff(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: 'Public tariff',
    description: 'The walk-in tariff.',
    status: 'active',
    is_default: true,
    versions: [
      {
        id: 7,
        version: 2,
        effective_from: '2026-08-15',
        currency: 'UGX',
        rounding_mode: 'half_up',
        rounding_mode_label: 'Half up',
        free_waiting_minutes: 3,
        night_starts_at: null,
        night_ends_at: null,
        night_multiplier_bp: 10_000,
        is_locked: false,
        notes: null,
        rates: [
          {
            vehicle_category: 'boda',
            base_fare_minor: 2_000,
            per_km_minor: 1_000,
            per_waiting_minute_minor: 200,
            minimum_charge_minor: 3_000,
            maximum_charge_minor: null,
            zone_rates: [],
          },
        ],
      },
    ],
    ...overrides,
  }
}

it('renames a card without adding a version', async () => {
  get.mockResolvedValue(apiOk([]))
  patch.mockResolvedValue(apiOk(tariff()))

  const onSaved = vi.fn()
  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={tariff() as never} onClose={vi.fn()} onSaved={onSaved} />)

  const name = await screen.findByLabelText(/Card name/)
  await user.clear(name)
  await user.type(name, 'Walk-in tariff')
  await user.click(screen.getByRole('button', { name: /Save changes/ }))

  await waitFor(() => expect(patch).toHaveBeenCalledWith('/rate-cards/3', expect.anything()))

  // The whole point. Nothing about the prices moved, so no version exists that
  // says otherwise — and the message says so rather than leaving somebody to
  // check the card afterwards.
  expect(post).not.toHaveBeenCalled()
  expect(onSaved).toHaveBeenCalledWith(expect.stringMatching(/no version was added/i))
})

it('adds a version when a price changes, and does not patch the card', async () => {
  get.mockResolvedValue(apiOk([]))
  post.mockResolvedValue(apiOk({ id: 9, version: 3 }))

  const onSaved = vi.fn()
  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={tariff() as never} onClose={vi.fn()} onSaved={onSaved} />)

  const baseFare = await screen.findByDisplayValue('2000')
  await user.clear(baseFare)
  await user.type(baseFare, '2500')
  await user.click(screen.getByRole('button', { name: /Save changes/ }))

  await waitFor(() => expect(post).toHaveBeenCalled())

  expect(post.mock.calls[0]![0]).toBe('/rate-cards/3/versions')
  // Name and description untouched, so there is nothing for a PATCH to say.
  expect(patch).not.toHaveBeenCalled()
  expect(onSaved).toHaveBeenCalledWith(expect.stringMatching(/version 3 added/i))
})

it('does both when both changed, and patches before it versions', async () => {
  get.mockResolvedValue(apiOk([]))
  patch.mockResolvedValue(apiOk(tariff()))
  post.mockResolvedValue(apiOk({ id: 9, version: 3 }))

  const order: string[] = []
  patch.mockImplementation(() => {
    order.push('patch')

    return Promise.resolve(apiOk(tariff()) as never)
  })
  post.mockImplementation(() => {
    order.push('post')

    return Promise.resolve(apiOk({ id: 9, version: 3 }) as never)
  })

  const user = userEvent.setup()
  renderAs(<RateCardVersionDialog card={tariff() as never} onClose={vi.fn()} onSaved={vi.fn()} />)

  const name = await screen.findByLabelText(/Card name/)
  await user.clear(name)
  await user.type(name, 'Walk-in tariff')

  const baseFare = screen.getByDisplayValue('2000')
  await user.clear(baseFare)
  await user.type(baseFare, '2500')

  await user.click(screen.getByRole('button', { name: /Save changes/ }))

  await waitFor(() => expect(order).toEqual(['patch', 'post']))

  // Details first. If the version is refused, the rename has landed and the
  // prices have not — the safe half to keep, because a card with the wrong name
  // still prices correctly. The other order leaves a version priced under a
  // name that was never saved.
})

it('shows the card’s own name and description when editing, not a blank form', async () => {
  get.mockResolvedValue(apiOk([]))

  renderAs(<RateCardVersionDialog card={tariff() as never} onClose={vi.fn()} onSaved={vi.fn()} />)

  // The complaint that started this: edit was a different, smaller form than
  // create. It is the same form now, carrying the same fields.
  expect(await screen.findByDisplayValue('Public tariff')).toBeInTheDocument()
  expect(screen.getByDisplayValue('The walk-in tariff.')).toBeInTheDocument()
  expect(screen.getByLabelText(/Status/)).toHaveValue('active')
})
