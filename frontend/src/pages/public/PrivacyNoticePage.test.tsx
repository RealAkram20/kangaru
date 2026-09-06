import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  getStoredToken: vi.fn(() => null),
  storeToken: vi.fn(),
  clearStoredToken: vi.fn(),
  getStoredCustomerToken: vi.fn(() => null),
  storeCustomerToken: vi.fn(),
  clearStoredCustomerToken: vi.fn(),
}))

vi.mock('./places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./places')>()),
  currentLocationPlace: vi.fn(),
  geolocationRefused: vi.fn(async () => false),
}))

const { apiClient, getStoredCustomerToken } = await import('../../lib/apiClient')
const post = vi.mocked(apiClient.post)
const get = vi.mocked(apiClient.get)
const storedCustomerToken = vi.mocked(getStoredCustomerToken)

const { currentLocationPlace } = await import('./places')
const locate = vi.mocked(currentLocationPlace)

const { PrivacyNoticePage } = await import('./PrivacyNoticePage')
const { OrderPage } = await import('./OrderPage')
const { AuthProvider } = await import('../../auth/AuthContext')

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/privacy']}>
        <PrivacyNoticePage />
      </MemoryRouter>
    </AuthProvider>,
  )
}

function renderOrderPage(url = '/order') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[url]}>
        <OrderPage />
      </MemoryRouter>
    </AuthProvider>,
  )
}

/** A returning account holder, as `/customer/auth/me` would answer. */
function signedInCustomer() {
  storedCustomerToken.mockReturnValue('a-customer-token')
  get.mockResolvedValue({
    data: {
      data: {
        id: 1,
        first_name: 'Nakato',
        last_name: 'Grace',
        name: 'Nakato Grace',
        gender: 'female',
        phone: '0700123456',
        email: 'nakato@example.com',
        created_at: null,
      },
    },
  })
}

beforeEach(() => {
  post.mockReset()
  get.mockReset()
  storedCustomerToken.mockReturnValue(null)
  localStorage.clear()
  locate.mockResolvedValue({ name: 'Current location', detail: 'Plot 9, Bukoto Street, Kampala' })
  post.mockImplementation(async (url: string) =>
    url.startsWith('/customer/auth/')
      ? { data: { data: { customer: {}, token: 't' } } }
      : { data: { data: { reference: 'KR-1' } } },
  )
})

describe('PrivacyNoticePage', () => {
  /*
    The controller's identity is the first thing the Act requires and the
    easiest to leave off, because it is the one fact a developer never has to
    look up to make the page render.
  */
  it('names the company answerable for the data', async () => {
    renderPage()

    /*
      Scoped to the section, because the site footer carries the same company
      name and an unscoped query matches both. That is not a bug in the page —
      the footer naming the operator is correct — but a bare `findByText` here
      would report "found multiple elements" and, worse, a version of this
      assertion that passed on the *footer* alone would pass on a page with no
      controller statement at all.
    */
    const heading = await screen.findByRole('heading', { name: 'Who is responsible' })
    const section = heading.closest('section')!

    expect(within(section).getByText(/Shanitah General Enterprises Ltd/)).toBeInTheDocument()
    expect(within(section).getByText(/answerable for it/i)).toBeInTheDocument()
  })

  /*
    The section a notice written from memory would omit entirely. Asserted on
    the *behaviour* being disclosed — that typing reaches a third party before
    submission — rather than on a provider's name, which would make this test
    fail the day the geocoder is swapped for an equivalent one.
  */
  it('discloses that the address box reaches a third party as it is typed', async () => {
    renderPage()

    expect(await screen.findByText('Who else sees it')).toBeInTheDocument()
    expect(screen.getByText(/sent to a mapping service/i)).toBeInTheDocument()
    expect(screen.getByText(/This happens before you submit/i)).toBeInTheDocument()
  })

  it('states a period for the trip record and for the GPS trace', async () => {
    renderPage()

    expect(await screen.findByText(/Trip and order records — 7 years/)).toBeInTheDocument()
    expect(screen.getByText(/The GPS trace of a trip — 12 months/)).toBeInTheDocument()
  })

  /*
    A customer who has just photographed their national ID will assume it was
    uploaded. It was not — OrderPage sends `Object.keys(kycFiles)` and never
    the files — and saying so is the one claim on this page that makes the
    platform look better than the reader expects.
  */
  it('says the rental identity documents stay on the device', async () => {
    renderPage()

    expect(await screen.findByText('What we do not collect')).toBeInTheDocument()
    expect(screen.getByText(/stay on your device/i)).toBeInTheDocument()
  })
})

describe('the privacy line at the point of collection', () => {
  /*
    The decision this asserts is the one that keeps the gate real: OrderPage
    holds the whole order in React state with nothing in the URL, so a link
    that navigated would destroy a part-finished order. `getByRole('link')`
    with the target checked — a plain text query would pass while the link
    navigated in place.
  */
  it('opens in a new tab so an order in progress survives being read', async () => {
    const user = userEvent.setup()
    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))
    await screen.findByText('Plot 9, Bukoto Street, Kampala')
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    const link = await screen.findByRole('link', { name: /what we do with your data/i })

    expect(link).toHaveAttribute('href', '/privacy')
    expect(link).toHaveAttribute('target', '_blank')
  })

  /*
    master-plan.md §5's gate, asserted on the surface that actually submits.
    A ride has no confirm screen — OrderPage's own comment says "the last tap
    of a ride: no confirm screen follows it" — so for a first-time customer
    the sign-up button IS the order. If the notice were wired only to the
    delivery summary this would fail, and that is the mistake it exists to
    catch.
  */
  /*
    The other half of the same gate, and the branch a signed-out walkthrough
    never reaches. A returning customer skips the account step entirely
    (ADR-0015 §3), so their "Request ride" on the vehicle step is the submit —
    and the line there is behind `customer !== null`. Driving the flow in a
    real browser only ever exercised the signed-out path, which is exactly how
    a one-branch disclosure ships looking verified.
  */
  it('is readable on the vehicle step for a customer who is already signed in', async () => {
    const user = userEvent.setup()
    signedInCustomer()
    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))
    await screen.findByText('Plot 9, Bukoto Street, Kampala')
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // No account step for them: this button places the order.
    expect(await screen.findByRole('button', { name: /request ride/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what we do with your data/i })).toBeInTheDocument()
  })

  /*
    The third collection point, and the one where the details being handed
    over are **somebody else's** — a delivery carries the sender's and the
    recipient's name and phone, and neither of them has visited this site.
  */
  it('is readable above Confirm Delivery', async () => {
    const user = userEvent.setup()
    signedInCustomer()
    renderOrderPage('/order?service=delivery&pickup=Seeta&dropoff=Ntinda')

    await user.click(await screen.findByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('button', { name: /confirm delivery/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what we do with your data/i })).toBeInTheDocument()
  })

  it('is readable on the sign-up step, which for a ride is the submit', async () => {
    const user = userEvent.setup()
    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))
    await screen.findByText('Plot 9, Bukoto Street, Kampala')
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // The step that collects name, phone and email, and places the ride.
    expect(screen.getByRole('button', { name: /request ride/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what we do with your data/i })).toBeInTheDocument()
  })
})
