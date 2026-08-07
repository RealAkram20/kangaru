import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../test/harness'
import type { CustomerProfile } from '../types/customer'
import { CustomersPage } from './CustomersPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const del = vi.mocked(apiClient.delete)

function customer(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    id: 5,
    first_name: 'Grace',
    last_name: 'Amongin',
    name: 'Grace Amongin',
    gender: null,
    phone: '+256700123456',
    email: 'grace@example.test',
    status: 'active',
    has_password: true,
    has_google: false,
    suspended_at: null,
    suspension_reason: null,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

function register(rows: CustomerProfile[] = [customer()], activity: unknown[] = []) {
  get.mockImplementation((url: string) => {
    if (url.includes('/activity')) return Promise.resolve(apiOk(activity))
    if (url.startsWith('/customers')) {
      return Promise.resolve(
        apiOk(rows, {
          cursor: { next: null },
          tally: {
            total: rows.length,
            active: rows.filter((r) => r.status === 'active').length,
            suspended: rows.filter((r) => r.status === 'suspended').length,
          },
        }),
      )
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  register()
})

/**
 * ADR-0018 on screen. Staff could not see that customers existed; a
 * dispatcher answering the phone had nothing to look the caller up in.
 */
describe('CustomersPage', () => {
  it('shows the register with its counts', async () => {
    register([customer(), customer({ id: 6, name: 'Moses Kato', status: 'suspended' })])

    renderAs(<CustomersPage />)

    expect(await screen.findByText('Grace Amongin')).toBeVisible()
    expect(screen.getByText(/2 registered · 1 active · 1 suspended/)).toBeVisible()
  })

  it('searches on the server rather than filtering what is loaded', async () => {
    const user = userEvent.setup()
    renderAs(<CustomersPage />)
    await screen.findByText('Grace Amongin')

    await user.type(screen.getByLabelText(/search customers/i), '0700123456')

    // The register is cursor-paginated, so a client-side filter would sift
    // only the first 25 rows — and a dispatcher who cannot find a caller
    // concludes they are not registered.
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('q=0700123456')))
  })

  it('does not search on a single character', async () => {
    const user = userEvent.setup()
    renderAs(<CustomersPage />)
    await screen.findByText('Grace Amongin')

    await user.type(screen.getByLabelText(/search customers/i), 'a')

    // One letter matches most of the register and costs a full scan to say
    // so. The server enforces `min:2`; sending it anyway would just be a
    // guaranteed 422.
    await waitFor(() => expect(get).not.toHaveBeenCalledWith(expect.stringContaining('q=a')))
  })

  it('says how a customer signs in, without saying what the credential is', async () => {
    const user = userEvent.setup()
    register([customer({ has_password: false, has_google: true })])

    renderAs(<CustomersPage />)
    await user.click(await screen.findByRole('button', { name: 'Open' }))

    // The first question on "I cannot log in" (ADR-0013 §3).
    expect(await screen.findByText('Google')).toBeVisible()
    expect(screen.queryByText(/password hash|google_id/i)).toBeNull()
  })

  it('suspends an account with a reason and reloads', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue(apiOk(customer({ status: 'suspended' })))

    renderAs(<CustomersPage />)
    await user.click(await screen.findByRole('button', { name: 'Open' }))

    await user.type(
      screen.getByLabelText(/reason for suspending/i),
      'Chargebacks on four consecutive rides.',
    )
    await user.click(screen.getByRole('button', { name: /suspend account/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/customers/5/suspension', {
        reason: 'Chargebacks on four consecutive rides.',
      }),
    )
  })

  it('puts the server error on the reason field when it is too thin', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        reason: ['Give a reason somebody could read back to the customer.'],
      }),
    )

    renderAs(<CustomersPage />)
    await user.click(await screen.findByRole('button', { name: 'Open' }))
    await user.type(screen.getByLabelText(/reason for suspending/i), 'n/a')
    await user.click(screen.getByRole('button', { name: /suspend account/i }))

    expect(
      await screen.findByText('Give a reason somebody could read back to the customer.'),
    ).toBeVisible()
  })

  it('offers restore rather than suspend for a suspended account, and shows why', async () => {
    const user = userEvent.setup()
    register([
      customer({
        status: 'suspended',
        suspension_reason: 'Chargebacks on four consecutive rides.',
      }),
    ])
    del.mockResolvedValue(apiOk(customer()))

    renderAs(<CustomersPage />)
    await user.click(await screen.findByRole('button', { name: 'Open' }))

    // A support agent's first job is to say why, so the reason is on the
    // panel rather than only in the audit log.
    expect(await screen.findByText('Chargebacks on four consecutive rides.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /suspend account/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: /restore account/i }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/customers/5/suspension'))
  })

  it("offers no way to reset somebody else's password", async () => {
    const user = userEvent.setup()
    renderAs(<CustomersPage />)
    await user.click(await screen.findByRole('button', { name: 'Open' }))

    // Deliberate, and the same line Modules/Administration draws for staff:
    // an administrator silently changing a member of the public's
    // credentials is the one act an audit trail cannot tell apart from
    // impersonation.
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByRole('button', { name: /reset|password/i })).toBeNull()
  })

  it("shows the customer's recent orders", async () => {
    const user = userEvent.setup()
    register(
      [customer()],
      [
        {
          id: 3,
          reference: 'KR-ABC123',
          service_type: 'ride',
          status: 'new',
          allowed_transitions: [],
          contact_name: 'Grace Amongin',
          contact_phone: '+256700123456',
          contact_email: null,
          pickup_location: 'Ntinda',
          dropoff_location: 'Entebbe',
          scheduled_for: null,
          details: null,
          notes: null,
          dispatcher_notes: null,
          handled_by: null,
          created_at: '2026-08-01T00:00:00.000000Z',
        },
      ],
    )

    renderAs(<CustomersPage />)
    await user.click(await screen.findByRole('button', { name: 'Open' }))

    expect(await screen.findByText(/Ntinda → Entebbe/)).toBeVisible()
  })
})
