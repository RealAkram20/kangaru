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
