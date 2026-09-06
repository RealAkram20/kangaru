import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../test/harness'
import { RateCardsPage } from './RateCardsPage'

/*
 * ADR-0050 §5: the page now reads router state, so that "Price it" on the
 * vehicle categories screen can open the version dialog on the card that is
 * missing a category. `renderAs` mounts no Router, and the same stub is what
 * NotificationsPage.test and CrossClientQueue.test already use.
 */
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/rate-cards', state: null }),
  useNavigate: () => vi.fn(),
}))

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)

beforeEach(() => {
  get.mockReset()
})

function version(id: number, no: number, baseFare: number) {
  return {
    id,
    version: no,
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
        base_fare_minor: baseFare,
        per_km_minor: 1_000,
        per_waiting_minute_minor: 200,
        minimum_charge_minor: 3_000,
        maximum_charge_minor: null,
        zone_rates: [],
      },
    ],
  }
}

function card(versions: ReturnType<typeof version>[]) {
  return {
    id: 3,
    name: 'Public tariff',
    description: null,
    status: 'active',
    is_default: true,
    versions,
    created_at: '2026-08-14T21:45:10.000000Z',
    updated_at: '2026-08-14T21:45:10.000000Z',
  }
}

it('renders the versions a card has, rather than claiming it has none', async () => {
  get.mockResolvedValue(apiOk([card([version(7, 2, 2_000)])]))

  renderAs(<RateCardsPage />)

  await waitFor(() => expect(screen.getByText('Public tariff')).toBeInTheDocument())

  // The listing bug rendered this sentence on a tariff pricing live trips,
  // under a "New version" button — a false, alarming claim rather than an
  // empty state. It survives here as the assertion that it is *absent*.
  expect(screen.queryByText(/no versions and cannot price a trip/i)).not.toBeInTheDocument()
})

it('shows the newest version after one is added, not the one that used to be newest', async () => {
  // Not the default, so the page renders a "Make default" button — a real
  // control whose handler refetches, which is how a fresh set of versions
  // reaches an already-mounted panel. Finance, because the manage controls are
  // gated on the role.
  const notDefault = { ...card([version(7, 2, 2_000)]), is_default: false }

  get.mockResolvedValueOnce(apiOk([notDefault])).mockResolvedValueOnce(apiOk([notDefault]))
  vi.mocked(apiClient.put).mockResolvedValue(apiOk(null))

  const user = userEvent.setup()
  renderAs(<RateCardsPage />, makeUser({ role: 'finance', tenant_id: null }))

  await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument())

  /*
   * A third version now exists, as it would immediately after the version
   * dialog saved. The panel picks which version to expand in a `useState`
   * initialiser, which runs once per mounted instance — so keyed on `card.id`
   * alone the instance survives the refetch and goes on showing v2 expanded.
   * Somebody has just changed a tariff and the screen appears not to notice.
   */
  get.mockResolvedValue(apiOk([{ ...card([version(9, 3, 2_500), version(7, 2, 2_000)]), is_default: true }]))

  await user.click(screen.getAllByRole('button', { name: /Make default/ })[0]!)

  await waitFor(() => expect(screen.getByText('v3')).toBeInTheDocument())

  // The new version is the one opened, so its prices are what a reader sees.
  await waitFor(() => expect(screen.getByText(/2,500/)).toBeInTheDocument())
})
