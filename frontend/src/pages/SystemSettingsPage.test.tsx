import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { apiFailure } from '../test/harness'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const patch = vi.mocked(apiClient.patch)

const { SystemSettingsPage } = await import('./SystemSettingsPage')

const SETTINGS = {
  branding: {
    app_name: 'KangaruRide',
    tagline: 'For Safety and Reliability',
    meta_description: null,
    contact_email: 'operations@kangaruride.com',
    contact_phone: null,
    logo_path: null,
    favicon_path: null,
  },
  legal: { terms: 'Ride safely.', privacy: 'We collect your phone number.' },
  auth: {
    password_reset_enabled: false,
    google_enabled: false,
    facebook_enabled: false,
    google_client_ids: '',
    facebook_app_id: '',
    facebook_app_secret: { configured: false },
  },
  regional: { currency: 'UGX', timezone: 'Africa/Kampala', date_format: 'DD MMM YYYY' },
  ordering: { walk_in_enabled: true, rate_limit_per_minute: 3 },
  booking: { approval_required: true, max_advance_days: 90 },
  billing: {
    driver_commission_percent: 20,
    bonus_enabled: false,
    bonus_weekly_trip_target: 40,
    bonus_weekly_amount_minor: 20000,
    // ADR-0036 and ADR-0037. Both schemes default off, like the bonus above.
    peak_enabled: false,
    peak_starts_at: '17:00',
    peak_ends_at: '20:00',
    peak_uplift_percent: 20,
    referral_enabled: false,
    referral_trip_target: 10,
    referral_reward_amount_minor: 10000,
  },
  tracking: { variance_threshold_percent: 10, odometer_max_km_per_trip: 2000 },
  mail: {
    enabled: false,
    host: null,
    port: 587,
    username: null,
    password: { configured: false },
    encryption: 'tls',
    from_address: null,
    from_name: null,
  },
  sms: {
    provider: '',
    sender_id: null,
    api_key: { configured: false },
    api_secret: { configured: false },
  },
  maps: {
    routing_enabled: false,
    routing_provider: 'osrm' as const,
    osrm_base_url: 'https://router.project-osrm.org',
    api_key: { configured: false },
  },
  payments: {
    mtn_momo_api_user: null,
    mtn_momo_api_key: { configured: true },
    airtel_money_client_id: null,
    airtel_money_client_secret: { configured: false },
  },
}

beforeEach(() => {
  get.mockReset()
  patch.mockReset()
})

describe('SystemSettingsPage', () => {
  it('renders the stored settings for an allowed role', async () => {
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    expect(await screen.findByLabelText(/app name/i)).toHaveValue('KangaruRide')
    expect(screen.getByLabelText(/^currency/i)).toHaveValue('UGX')
    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Africa/Kampala')
  })

  it('never renders the stored Google key, only whether one exists', async () => {
    // Directions bills per request, so a key that reaches the browser bundle
    // is somebody else's traffic on this operator's invoice — and unlike a
    // password there is nothing to reset that does not also break the feature.
    // The API answers `configured` and nothing more (ADR-0014 §3); this proves
    // the card is built for that shape rather than expecting a value.
    get.mockResolvedValue({
      data: {
        data: {
          settings: {
            ...SETTINGS,
            maps: {
              ...SETTINGS.maps,
              routing_enabled: true,
              routing_provider: 'google',
              api_key: { configured: true },
            },
          },
        },
      },
    })

    render(<SystemSettingsPage />)

    // Scoped to this field rather than to the hint text, which the payments
    // card also shows for its own configured secret.
    const field = await screen.findByLabelText(/google directions api key/i)

    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', '••••••••')
    expect(field).toHaveAttribute('type', 'password')
  })

  it('warns that Google costs money, on the one setting that does', async () => {
    get.mockResolvedValue({
      data: {
        data: {
          settings: { ...SETTINGS, maps: { ...SETTINGS.maps, routing_provider: 'google' } },
        },
      },
    })

    render(<SystemSettingsPage />)

    expect(await screen.findByText(/costs money per trip/i)).toBeInTheDocument()
  })

  it('offers no key field on the free engine, and says it is not production-ready', async () => {
    // OSRM needs no credential, so asking for one would leave an operator
    // filling in a box that changes nothing — and the demo server's limits
    // are exactly the thing somebody must know before a fleet leans on it.
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    expect(await screen.findByLabelText(/osrm server address/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/google directions api key/i)).not.toBeInTheDocument()
    expect(screen.getByText(/not meant for production/i)).toBeInTheDocument()
  })

  it('treats a 403 as an answer, not an error', async () => {
    get.mockRejectedValue(
      apiFailure(403, 'FORBIDDEN', 'You do not have permission to perform this action.'),
    )

    render(<SystemSettingsPage />)

    expect(
      await screen.findByText(/not available to your role/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/app name/i)).not.toBeInTheDocument()
  })

  it('saves a group and acknowledges on the button', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockResolvedValue({
      data: {
        data: {
          settings: {
            ...SETTINGS,
            branding: { ...SETTINGS.branding, app_name: 'Shanitah Rides' },
          },
        },
      },
    })

    render(<SystemSettingsPage />)

    const name = await screen.findByLabelText(/app name/i)
    await user.clear(name)
    await user.type(name, 'Shanitah Rides')
    await user.click(screen.getAllByRole('button', { name: /save changes/i })[0])

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/settings/branding', {
      app_name: 'Shanitah Rides',
      tagline: 'For Safety and Reliability',
      meta_description: null,
      contact_email: 'operations@kangaruride.com',
      contact_phone: null,
    }))
    // The save feedback: the button itself says so, quietly.
    expect(await screen.findByRole('button', { name: /saved/i })).toBeInTheDocument()
  })

  it('never sends an untouched secret, and never displays a stored one', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)
    await screen.findByLabelText(/app name/i)

    // A stored credential shows only that it exists.
    expect(screen.getByText(/configured\. stored values are never shown/i)).toBeInTheDocument()

    // Saving the payments card with untouched secret boxes must omit the
    // secret keys entirely — "leave it" is absence, not an empty write.
    await user.type(screen.getByLabelText(/mtn momo api user/i), 'momo-user')
    const paymentsSave = screen.getAllByRole('button', { name: /save changes/i }).at(-1)!
    await user.click(paymentsSave)

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/settings/payments', {
      mtn_momo_api_user: 'momo-user',
      airtel_money_client_id: null,
    }))
  })

  it('gives the driver-pay group a card at last, and saves the whole group', async () => {
    // `billing` has been in the catalogue since ADR-0029 and gained the bonus
    // keys in ADR-0034, with no UI either time — so the commission rate and
    // the bonus scheme were reachable only by an API client. An unreachable
    // setting is not a setting.
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    const commission = await screen.findByLabelText(/commission the platform keeps/i)
    expect(commission).toHaveValue(20)

    await user.clear(commission)
    await user.type(commission, '25')
    await user.click(screen.getByLabelText(/award a weekly bonus/i))

    // Scoped to the form this field lives in rather than a test id. Ten cards
    // render a "Save changes" button, and adding an attribute to `Card` that
    // exists only for tests would put test scaffolding in production markup.
    await user.click(
      within(commission.closest('form')!).getByRole('button', { name: /save changes/i }),
    )

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/settings/billing', {
        driver_commission_percent: 25,
        bonus_enabled: true,
        bonus_weekly_trip_target: 40,
        bonus_weekly_amount_minor: 20000,
        // ADR-0036 and ADR-0037 widened this card. The group is saved whole,
        // so the untouched schemes must travel back **unchanged** — a partial
        // PATCH here would silently switch off whatever the office had
        // running the moment somebody edited the commission rate.
        peak_enabled: false,
        peak_starts_at: '17:00',
        peak_ends_at: '20:00',
        peak_uplift_percent: 20,
        referral_enabled: false,
        referral_trip_target: 10,
        referral_reward_amount_minor: 10000,
      }),
    )
  })

  it('lets the office set the odometer ceiling and the variance threshold', async () => {
    // ADR-0035. The threshold was an env var — a deploy to change, invisible
    // here, unaudited — and the ceiling did not exist, which is how a mistyped
    // digit priced a 90,004 km journey at UGX 198,013,800.
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    const ceiling = await screen.findByLabelText(/longest single trip/i)
    expect(ceiling).toHaveValue(2000)

    await user.clear(ceiling)
    await user.type(ceiling, '300')
    await user.click(
      within(ceiling.closest('form')!).getByRole('button', { name: /save changes/i }),
    )

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/settings/tracking', {
        variance_threshold_percent: 10,
        odometer_max_km_per_trip: 300,
      }),
    )
  })

  it('says plainly that a flagged trip is still billed', async () => {
    // The card must not imply a control it does not have. Flagging is a review
    // signal: the invoice still goes out and the driver is still paid, and the
    // fare is priced from the odometer rather than the GPS trace.
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    expect(await screen.findByText(/only flags — it does not stop anything/i)).toBeInTheDocument()
  })

  it('shows the server message against the failing field', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        contact_email: ['This is not an email address.'],
      }),
    )

    render(<SystemSettingsPage />)

    await screen.findByLabelText(/app name/i)
    await user.click(screen.getAllByRole('button', { name: /save changes/i })[0])

    expect(await screen.findByText('This is not an email address.')).toBeInTheDocument()
  })
})
