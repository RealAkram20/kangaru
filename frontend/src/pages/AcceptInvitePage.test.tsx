import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, renderAs } from '../test/harness'
import { AcceptInvitePage } from './AcceptInvitePage'

vi.mock('../lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')

  return { ...actual, useNavigate: () => navigate }
})

beforeEach(() => vi.clearAllMocks())

/**
 * The page is rendered inside a route so `useParams` sees a token, which is
 * the whole input: there is no other identification on this screen.
 *
 * `renderAs(..., null)` throughout. A signed-in user is redirected away, and a
 * fixture with a session would test the redirect rather than the page.
 */
function renderInvite(token = 'a-token') {
  return renderAs(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
      </Routes>
    </MemoryRouter>,
    null,
  )
}

it('shows whose account the link opens before asking for a password', async () => {
  get.mockResolvedValue(
    apiOk({
      name: 'Grace Amongin',
      email: 'grace@nakumatt.test',
      expires_at: '2026-08-30T21:00:00+00:00',
    }),
  )

  renderInvite()

  /*
   * The reader arrived from an email asking them to set a password on a
   * service they may never have used, which is the exact shape of a phishing
   * attempt. A bare password form gives them nothing to check it against.
   */
  expect(await screen.findByText(/Grace Amongin/)).toBeInTheDocument()
  expect(screen.getByText(/grace@nakumatt\.test/)).toBeInTheDocument()
})

it('says so when the link does not work, in the server\'s own words', async () => {
  // The server distinguishes unknown, already used and expired, and the three
  // send the reader to three different places. The page must not collapse
  // them into a house sentence.
  get.mockRejectedValue({
    isAxiosError: true,
    response: { status: 410, data: { code: 'INVITATION_EXPIRED', message: 'That invitation has expired.' } },
  })

  renderInvite()

  expect(await screen.findByText('That invitation has expired.')).toBeInTheDocument()
  expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument()
})

it('refuses two passwords that do not match, without asking the server', async () => {
  get.mockResolvedValue(
    apiOk({ name: 'Grace Amongin', email: 'grace@nakumatt.test', expires_at: '2026-08-30T21:00:00+00:00' }),
  )

  renderInvite()
  await screen.findByText(/Grace Amongin/)

  await userEvent.type(screen.getByLabelText(/^Password/), 'a-real-password-9')
  await userEvent.type(screen.getByLabelText(/^Confirm password/), 'a-different-one-9')
  await userEvent.click(screen.getByRole('button', { name: /Set password/ }))

  expect(await screen.findByRole('alert')).toHaveTextContent('The two passwords do not match.')
  // Told before a round trip, not after.
  expect(post).not.toHaveBeenCalled()
})

it('sends the password once, then goes to sign in rather than straight into the app', async () => {
  get.mockResolvedValue(
    apiOk({ name: 'Grace Amongin', email: 'grace@nakumatt.test', expires_at: '2026-08-30T21:00:00+00:00' }),
  )
  post.mockResolvedValue(apiOk(null))

  renderInvite('the-token')
  await screen.findByText(/Grace Amongin/)

  await userEvent.type(screen.getByLabelText(/^Password/), 'a-real-password-9')
  await userEvent.type(screen.getByLabelText(/^Confirm password/), 'a-real-password-9')
  await userEvent.click(screen.getByRole('button', { name: /Set password/ }))

  expect(post).toHaveBeenCalledWith('/invitations/the-token/accept', {
    password: 'a-real-password-9',
    password_confirmation: 'a-real-password-9',
  })

  /*
   * Sign-in, not the dashboard. The backend answers a message rather than a
   * session so a Super Admin or a Finance officer cannot skip the second
   * factor ADR-0008 requires of them, and those are exactly the roles most
   * likely to be invited. A page that navigated to `/` would be promising a
   * session the server did not give.
   */
  expect(navigate).toHaveBeenCalledWith('/login', { replace: true })
})
