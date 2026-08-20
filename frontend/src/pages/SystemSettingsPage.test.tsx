import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
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
  tracking: {
    odometer_enabled: true,
    trace_route_ceiling_percent: 30,
    variance_threshold_percent: 10,
    odometer_max_km_per_trip: 2000,
  },
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

/**
 * Open a section from the rail.
 *
 * Every pane stays mounted and only the active one is displayed, so a query
 * that reads the DOM (`getByLabelText`) finds a hidden section's fields while
 * one that reads the accessibility tree (`getByRole`) does not. Tests go
 * through the rail rather than exploiting that difference, because that is
 * what a person has to do.
 */
async function open(user: UserEvent, name: RegExp) {
  await user.click(await screen.findByRole('button', { name }))
}

/** The section's own Save. Only the visible pane has one in the a11y tree. */
function saveButton() {
  return screen.getByRole('button', { name: /save changes/i })
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

  it('shows one section at a time, and the rail moves between them', async () => {
    // The whole point of the rebuild: twelve groups became somewhere to go
    // rather than four thousand pixels to scroll. If every pane were on screen
    // at once this would be the old page with a decorative sidebar.
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    // `getByRole` skips what is hidden from the accessibility tree, which is
    // the point being proved — so the hidden pane is found by its text and
    // then asserted invisible.
    expect(await screen.findByRole('heading', { name: 'Branding' })).toBeVisible()
    expect(screen.getByText(/email \(smtp\)/i)).not.toBeVisible()

    await open(user, /^email/i)

    expect(screen.getByRole('heading', { name: /email \(smtp\)/i })).toBeVisible()
    expect(screen.getByText('Branding', { selector: 'h2' })).not.toBeVisible()
  })

  it('keeps what was typed in a section the reader navigates away from', async () => {
    // Panes are hidden, not unmounted. A half-typed SMTP host that vanished
    // because somebody checked the commission rate is the kind of loss that
    // teaches people not to trust a settings page.
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    await open(user, /^email/i)
    await user.type(screen.getByLabelText(/smtp host/i), 'smtp.example.com')

    await open(user, /^branding/i)
    await open(user, /^email/i)

    expect(screen.getByLabelText(/smtp host/i)).toHaveValue('smtp.example.com')
  })

  it('marks an edited section in the rail and in its own bar, and Discard puts it back', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    const name = await screen.findByLabelText(/app name/i)
    expect(screen.queryByText(/unsaved changes/i)).toBeNull()

    await user.type(name, ' Ltd')

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    // And the rail says so too, in words rather than in colour alone, so it
    // is still readable from another section.
    expect(screen.getByRole('button', { name: /branding unsaved changes/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /discard/i }))

    expect(name).toHaveValue('KangaruRide')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('never renders the stored Google key, only whether one exists', async () => {
    // Directions bills per request, so a key that reaches the browser bundle
    // is somebody else's traffic on this operator's invoice — and unlike a
    // password there is nothing to reset that does not also break the feature.
    // The API answers `configured` and nothing more (ADR-0014 §3); this proves
    // the section is built for that shape rather than expecting a value.
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

    expect(await screen.findByText(/not available to your role/i)).toBeInTheDocument()
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
    await user.click(saveButton())

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/settings/branding', {
        app_name: 'Shanitah Rides',
        tagline: 'For Safety and Reliability',
        meta_description: null,
        contact_email: 'operations@kangaruride.com',
        contact_phone: null,
      }),
    )
    // The save feedback: the button itself says so, quietly.
    expect(await screen.findByRole('button', { name: /saved/i })).toBeInTheDocument()
  })

  it('acknowledges the save before the server has answered', async () => {
    // Optimistic, and it costs nothing in honesty: the form's source of truth
    // is its own state, so the server's answer is never needed to keep showing
    // what was typed. The next test is the other half of that bargain.
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    let answer: (value: unknown) => void = () => {}
    patch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )

    render(<SystemSettingsPage />)

    await user.type(await screen.findByLabelText(/app name/i), '!')
    await user.click(saveButton())

    // Nothing has come back yet, and the interface has already agreed.
    expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument()
    expect(screen.queryByText('Unsaved changes')).toBeNull()

    answer({ data: { data: { settings: SETTINGS } } })
  })

  it('takes the acknowledgement back when the server refuses', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        contact_email: ['This is not an email address.'],
      }),
    )

    render(<SystemSettingsPage />)

    await user.type(await screen.findByLabelText(/app name/i), '!')
    await user.click(saveButton())

    // The rollback, and the whole reason optimism is allowed here: the typed
    // value is still on screen, the section is unsaved again, and the reason
    // is against the field that caused it.
    expect(await screen.findByText('This is not an email address.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByLabelText(/app name/i)).toHaveValue('KangaruRide!')
  })

  it('never sends an untouched secret, and never displays a stored one', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)
    await open(user, /payment gateways/i)

    // A stored credential shows only that it exists.
    expect(screen.getByText(/configured\. type to replace it\./i)).toBeInTheDocument()

    // Saving with untouched secret boxes must omit the secret keys entirely —
    // "leave it" is absence, not an empty write.
    await user.type(screen.getByLabelText(/mtn momo api user/i), 'momo-user')
    await user.click(saveButton())

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/settings/payments', {
        mtn_momo_api_user: 'momo-user',
        airtel_money_client_id: null,
      }),
    )
  })

  it('gives the driver-pay group a section at last, and saves the whole group', async () => {
    // `billing` has been in the catalogue since ADR-0029 and gained the bonus
    // keys in ADR-0034, with no UI either time — so the commission rate and
    // the bonus scheme were reachable only by an API client. An unreachable
    // setting is not a setting.
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })
    patch.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)
    await open(user, /driver pay/i)

    const commission = screen.getByLabelText(/commission the platform keeps/i)
    expect(commission).toHaveValue(20)

    await user.clear(commission)
    await user.type(commission, '25')
    await user.click(screen.getByLabelText(/award a weekly bonus/i))
    await user.click(saveButton())

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/settings/billing', {
        driver_commission_percent: 25,
        bonus_enabled: true,
        bonus_weekly_trip_target: 40,
        bonus_weekly_amount_minor: 20000,
        // ADR-0036 and ADR-0037 widened this group. The group is saved whole,
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
    await open(user, /distance checks/i)

    const ceiling = screen.getByLabelText(/longest single trip/i)
    expect(ceiling).toHaveValue(2000)

    await user.clear(ceiling)
    await user.type(ceiling, '300')
    await user.click(saveButton())

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/settings/tracking', {
        // The whole group travels, so the two keys this section does not edit
        // are still sent at their current values rather than being dropped.
        odometer_enabled: true,
        trace_route_ceiling_percent: 30,
        variance_threshold_percent: 10,
        odometer_max_km_per_trip: 300,
      }),
    )
  })

  it('says plainly that a flagged trip is still billed', async () => {
    // The section must not imply a control it does not have. Flagging is a
    // review signal: the invoice still goes out and the driver is still paid.
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)

    expect(await screen.findByText(/only flags — it does not stop anything/i)).toBeInTheDocument()
  })

  it('warns about the Bank before the odometer can be switched off', async () => {
    // **The safeguard the whole platform-wide scope rests on.** The owner
    // chose a switch that reaches corporate trips too, having been offered a
    // walk-in-only version; the honest implementation is to make the
    // consequence impossible to miss at the moment of the decision, rather
    // than to quietly narrow what they asked for or bury it in an ADR.
    //
    // ADR-0047, and PROJECT.md's acceptance criterion #4.
    const user = userEvent.setup()
    get.mockResolvedValue({ data: { data: { settings: SETTINGS } } })

    render(<SystemSettingsPage />)
    await open(user, /distance checks/i)

    const toggle = screen.getByLabelText(/drivers record odometer readings/i)

    // Nothing alarming while it is on — the default, and where almost every
    // deployment stays.
    expect(screen.queryByText(/acceptance criteria the Bank signed off/)).toBeNull()

    await user.click(toggle)

    expect(await screen.findByText(/acceptance criteria the Bank signed off/)).toBeTruthy()
    // And it says the part that is easiest to assume otherwise: this is not
    // walk-in only.
    expect(screen.getByText(/including trips for corporate clients/)).toBeTruthy()
  })
})
