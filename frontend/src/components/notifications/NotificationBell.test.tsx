import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiOk, renderAs } from '../../test/harness'
import type { AppNotification } from '../../types/notification'
import { NotificationBell } from './NotificationBell'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), patch: vi.fn() },
}))

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const patch = vi.mocked(apiClient.patch)

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1,
    type: 'booking.approved',
    type_label: 'Booking approved',
    subject: 'Booking #41 approved',
    body: 'Your transport request from Kampala to Entebbe has been approved.',
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

describe('NotificationBell', () => {
  it('puts the unread count in the accessible name, not only in the badge', async () => {
    inbox([notification(), notification({ id: 2 })])

    renderAs(<NotificationBell />)

    // A red dot is invisible to a screen reader. "Notifications, 2 unread"
    // is the whole point of the control being reachable at all.
    expect(await screen.findByRole('button', { name: /notifications, 2 unread/i })).toBeInTheDocument()
  })

  it('says just "Notifications" when nothing is unread', async () => {
    inbox([notification({ is_read: true })], 0)

    renderAs(<NotificationBell />)

    expect(await screen.findByRole('button', { name: /^notifications$/i })).toBeInTheDocument()
  })

  it('opens a panel listing recent notifications', async () => {
    const user = userEvent.setup()
    renderAs(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: /notifications/i }))

    const panel = screen.getByRole('dialog', { name: /notifications/i })
    expect(within(panel).getByText('Booking #41 approved')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderAs(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: /notifications/i }))
    expect(screen.getByRole('dialog', { name: /notifications/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    // A panel that can only be dismissed by the button that opened it traps
    // anyone who clicked elsewhere expecting it to go away.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /notifications/i })).not.toBeInTheDocument(),
    )
  })

  it('closes when clicking outside it', async () => {
    const user = userEvent.setup()
    renderAs(
      <div>
        <NotificationBell />
        <button>Somewhere else</button>
      </div>,
    )

    await user.click(await screen.findByRole('button', { name: /notifications/i }))
    await user.click(screen.getByRole('button', { name: /somewhere else/i }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /notifications/i })).not.toBeInTheDocument(),
    )
  })

  it('marks a notification read and navigates when it is opened', async () => {
    const user = userEvent.setup()
    renderAs(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: /notifications/i }))
    await user.click(screen.getByText('Booking #41 approved'))

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/notifications/1'))
    expect(navigate).toHaveBeenCalledWith('/bookings/41')
  })

  it('does not re-mark a notification that is already read', async () => {
    const user = userEvent.setup()
    inbox([notification({ is_read: true, read_at: new Date().toISOString() })], 0)

    renderAs(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: /notifications/i }))
    await user.click(screen.getByText('Booking #41 approved'))

    // The server treats a repeat as a no-op so the timestamp is not moved,
    // but there is no reason to send the request at all.
    expect(patch).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/bookings/41')
  })

  it('offers mark-all only when something is unread', async () => {
    const user = userEvent.setup()
    inbox([notification({ is_read: true })], 0)

    renderAs(<NotificationBell />)
    await user.click(await screen.findByRole('button', { name: /notifications/i }))

    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument()
  })

  it('links through to the full inbox', async () => {
    const user = userEvent.setup()
    renderAs(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: /notifications/i }))
    await user.click(screen.getByRole('button', { name: /see all notifications/i }))

    expect(navigate).toHaveBeenCalledWith('/notifications')
  })

  it('shows an empty state rather than a blank panel', async () => {
    const user = userEvent.setup()
    inbox([])

    renderAs(<NotificationBell />)
    await user.click(await screen.findByRole('button', { name: /notifications/i }))

    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
  })

  it('asks for only a short list, since the page holds the rest', async () => {
    renderAs(<NotificationBell />)

    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(get).toHaveBeenCalledWith(expect.stringContaining('limit=8'))
  })
})
