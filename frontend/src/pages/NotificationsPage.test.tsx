import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../test/harness'
import type { AppNotification } from '../types/notification'
import { NotificationsPage } from './NotificationsPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), patch: vi.fn() },
}))

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const patch = vi.mocked(apiClient.patch)

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1,
    type: 'booking.approved',
    type_label: 'Booking approved',
    subject: 'Booking #41 approved',
    body: 'Your transport request from Kampala to Entebbe has been approved as an immediate request.',
    url: '/bookings/41',
    context: { booking_id: 41 },
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function inbox(items: AppNotification[], unread = items.filter((i) => !i.is_read).length) {
  get.mockResolvedValue(apiOk(items, { unread }))
}

beforeEach(() => {
  vi.clearAllMocks()
  inbox([notification()])
  patch.mockResolvedValue(apiOk({}))
})

describe('NotificationsPage', () => {
  it('shows the message the recipient was actually sent', async () => {
    renderAs(<NotificationsPage />)

    // The server renders and freezes subject and body at dispatch time —
    // the client displays them rather than rebuilding the sentence from
    // `context`, which could tell the reader something else later.
    expect(await screen.findByText('Booking #41 approved')).toBeInTheDocument()
    expect(screen.getByText(/Kampala to Entebbe/)).toBeInTheDocument()
    expect(screen.getByText('1 unread')).toBeInTheDocument()
  })

  it('marks one read and drops the unread count without waiting for the server', async () => {
    const user = userEvent.setup()
    renderAs(<NotificationsPage />)

    await user.click(await screen.findByRole('button', { name: /mark read/i }))

    // Optimistic: the endpoint is scoped to the caller's own inbox and
    // cannot refuse, so a badge that lags a click by a round trip just
    // feels broken.
    expect(await screen.findByText('Everything read')).toBeInTheDocument()
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/notifications/1'))
  })

  it('marks everything read in one call', async () => {
    const user = userEvent.setup()
    inbox([notification(), notification({ id: 2, subject: 'Booking #42 not approved' })])

    renderAs(<NotificationsPage />)

    await user.click(await screen.findByRole('button', { name: /mark all read/i }))

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/notifications'))
    expect(patch).toHaveBeenCalledTimes(1)
  })

  it('disables mark-all when nothing is unread', async () => {
    inbox([notification({ is_read: true, read_at: new Date().toISOString() })], 0)

    renderAs(<NotificationsPage />)

    await screen.findByText('Booking #41 approved')
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled()
  })

  it('filters to unread only, and asks the server rather than filtering locally', async () => {
    const user = userEvent.setup()
    renderAs(<NotificationsPage />)

    await screen.findByText('Booking #41 approved')

    await user.click(screen.getByRole('button', { name: /unread only/i }))

    // Server-side, because the page holds at most the first hundred rows —
    // filtering those locally would show "nothing unread" while unread
    // notifications sat beyond the limit.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('unread=1')),
    )
    expect(screen.getByRole('button', { name: /unread only/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('navigates to what the notification is about, marking it read on the way', async () => {
    const user = userEvent.setup()
    renderAs(<NotificationsPage />)

    await user.click(await screen.findByRole('button', { name: /^open$/i }))

    expect(navigate).toHaveBeenCalledWith('/bookings/41')
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/notifications/1'))
  })

  it('offers no Open button when there is nowhere to go', async () => {
    inbox([notification({ url: null })])

    renderAs(<NotificationsPage />)

    await screen.findByText('Booking #41 approved')
    // Null is deliberate on the server for notifications with no useful
    // destination; a link to a list would be worse than none.
    expect(screen.queryByRole('button', { name: /^open$/i })).not.toBeInTheDocument()
  })

  it('distinguishes an empty inbox from an empty filter', async () => {
    const user = userEvent.setup()
    inbox([])

    renderAs(<NotificationsPage />)

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /unread only/i }))

    expect(await screen.findByText('Nothing unread')).toBeInTheDocument()
  })

  it('says so when the inbox cannot be loaded', async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Notifications are unavailable right now.'))

    renderAs(<NotificationsPage />)

    expect(await screen.findByText('Notifications unavailable')).toBeInTheDocument()
    expect(screen.getByText('Notifications are unavailable right now.')).toBeInTheDocument()
  })
})
