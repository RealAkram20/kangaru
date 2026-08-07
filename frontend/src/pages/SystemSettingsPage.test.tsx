import { render, screen, waitFor } from '@testing-library/react'
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
  regional: { currency: 'UGX', timezone: 'Africa/Kampala', date_format: 'DD MMM YYYY' },
  ordering: { walk_in_enabled: true, rate_limit_per_minute: 3 },
  booking: { approval_required: true, max_advance_days: 90 },
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
