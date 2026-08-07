import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  // AuthProvider reads these; with no stored token it never calls the API,
  // which is exactly the signed-out visitor most of these cases describe.
  getStoredToken: vi.fn(() => null),
  storeToken: vi.fn(),
  clearStoredToken: vi.fn(),
  // The customer session (ADR-0015) keeps its own key, so it gets its own
  // trio. Returning null by default is the first-time visitor.
  getStoredCustomerToken: vi.fn(() => null),
  storeCustomerToken: vi.fn(),
  clearStoredCustomerToken: vi.fn(),
}))

const { apiClient, getStoredCustomerToken } = await import('../../lib/apiClient')
const post = vi.mocked(apiClient.post)
const get = vi.mocked(apiClient.get)
const storedCustomerToken = vi.mocked(getStoredCustomerToken)

/** The account the register/login endpoints hand back in these tests. */
const CUSTOMER = {
  id: 1,
  first_name: 'Nakato',
  last_name: 'Grace',
  name: 'Nakato Grace',
  gender: 'female',
  phone: '0700123456',
  email: 'nakato@example.com',
  created_at: null,
}

/**
 * One `post` mock serves two endpoints now — customer auth and the order
 * write — so it dispatches on the URL rather than on call order, which
 * would break the moment a step is inserted.
 */
function mockApi(reference = 'KR-7XKPQ2') {
  post.mockImplementation(async (url: string) =>
    url.startsWith('/customer/auth/')
      ? { data: { data: { customer: CUSTOMER, token: 'customer-token' } } }
      : { data: { data: { reference } } },
  )
}

/** Put an already-signed-in customer in the tree, as /customer/auth/me would. */
function signedInCustomer() {
  storedCustomerToken.mockReturnValue('a-customer-token')
  get.mockResolvedValue({ data: { data: CUSTOMER } })
}

/**
 * jsdom has neither geolocation nor a geocoder, so the device lookup is
 * stubbed at the module boundary — otherwise the pickup default would be
 * silently skipped rather than tested.
 */
vi.mock('./places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./places')>()),
  currentLocationPlace: vi.fn(),
  geolocationRefused: vi.fn(async () => false),
}))

const { currentLocationPlace } = await import('./places')
const locate = vi.mocked(currentLocationPlace)

const { OrderPage } = await import('./OrderPage')
const { AuthProvider } = await import('../../auth/AuthContext')

function renderOrderPage(url = '/order') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[url]}>
        <OrderPage />
      </MemoryRouter>
    </AuthProvider>,
  )
}

beforeEach(() => {
  post.mockReset()
  get.mockReset()
  storedCustomerToken.mockReturnValue(null)
  localStorage.clear()
  locate.mockResolvedValue({ name: 'Current location', detail: 'Plot 9, Bukoto Street, Kampala' })
  mockApi()
})

/** Fill the sign-up step and create the account (ADR-0015 §1). */
async function completeSignup(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/first name/i), 'Nakato')
  await user.type(screen.getByLabelText(/last name/i), 'Grace')
  await user.type(screen.getByLabelText(/phone number/i), '0700123456')
  await user.type(screen.getByLabelText(/email address/i), 'nakato@example.com')
  await user.type(screen.getByLabelText(/^password$/i), 'kampala-rides-1')
  await user.click(screen.getByRole('button', { name: /create account/i }))
}

describe('OrderPage', () => {
  it('walks a ride order from service through sign-up to a reference', async () => {
    const user = userEvent.setup()
    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))

    // The pickup arrives from the device, so only the destination is asked.
    expect(await screen.findByText('Plot 9, Bukoto Street, Kampala')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // The vehicle chooser: swap the default Economy for a boda.
    await user.click(screen.getByRole('radio', { name: /boda boda/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Sign-up, locked until every required field is answered. For a ride
    // this same tap places the order — there is no confirm screen.
    expect(screen.getByRole('button', { name: /request ride/i })).toBeDisabled()
    await completeSignup(user)

    expect(await screen.findByText('KR-7XKPQ2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /place order/i })).not.toBeInTheDocument()

    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as Record<string, unknown>
    expect(payload.service_type).toBe('ride')
    // Contact details come off the account, not off a form.
    expect(payload.contact_name).toBe('Nakato Grace')
    expect(payload.contact_phone).toBe('0700123456')
    expect(payload.contact_email).toBe('nakato@example.com')
    expect((payload.details as Record<string, unknown>).vehicle_class).toBe('boda')
    // The honeypot stays home when a human fills the form.
    expect(payload.website).toBeUndefined()
  })

  /**
   * ADR-0020 §2. The form has held `lngLat` since the map needed it to
   * centre; it was never sent, so the platform discarded the one input that
   * makes proximity dispatch possible and then had nothing to rank by.
   */
  it('sends the pickup coordinates when the place is known', async () => {
    const user = userEvent.setup()
    locate.mockResolvedValue({
      name: 'Current location',
      detail: 'Plot 9, Bukoto Street, Kampala',
      lngLat: [32.5825, 0.3476],
    })
    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))
    expect(await screen.findByText('Plot 9, Bukoto Street, Kampala')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await completeSignup(user)

    await screen.findByText('KR-7XKPQ2')

    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as Record<string, unknown>

    // Latitude and longitude the right way round: `lngLat` is [lng, lat],
    // and swapping them puts a Kampala pickup off the coast of Ghana with
    // both values still inside their valid ranges — which no validation
    // rule can catch.
    expect(payload.pickup_latitude).toBe(0.3476)
    expect(payload.pickup_longitude).toBe(32.5825)
  })

  it('sends no coordinates when the geocoder gave none', async () => {
    const user = userEvent.setup()
    // The default mock has no `lngLat` — a geocoder outage, which
    // `places.ts` promises degrades to plain text rather than an error.
    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))
    expect(await screen.findByText('Plot 9, Bukoto Street, Kampala')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await completeSignup(user)

    await screen.findByText('KR-7XKPQ2')

    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as Record<string, unknown>

    // Absent, not null: the order still goes through on the typed text.
    expect(payload).not.toHaveProperty('pickup_latitude')
    expect(payload.pickup_location).toBeTruthy()
  })

  it('sends the sign-up with split names and the stated gender', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.selectOptions(screen.getByLabelText(/gender/i), 'female')
    await completeSignup(user)

    const register = post.mock.calls.find(([url]) => url === '/customer/auth/register')!
    expect(register[1]).toMatchObject({
      first_name: 'Nakato',
      last_name: 'Grace',
      gender: 'female',
      phone: '0700123456',
      email: 'nakato@example.com',
      password: 'kampala-rides-1',
    })
  })

  it('treats an unanswered gender as null rather than inventing one', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await completeSignup(user)

    const register = post.mock.calls.find(([url]) => url === '/customer/auth/register')!
    expect((register[1] as Record<string, unknown>).gender).toBeNull()
  })

  it('never asks a signed-in customer to sign up again', async () => {
    const user = userEvent.setup()
    signedInCustomer()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')

    await user.click(await screen.findByRole('button', { name: /continue/i }))

    // The vehicle step is the last one: no sign-up, and for a ride no
    // confirm screen either, so this button hails rather than advances.
    expect(await screen.findByRole('button', { name: /request ride/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /request ride/i }))
    expect(await screen.findByText('KR-7XKPQ2')).toBeInTheDocument()

    // The order still carries the account's details, and no register call
    // was made for somebody who already has an account.
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    expect((order[1] as Record<string, unknown>).contact_name).toBe('Nakato Grace')
    expect(post.mock.calls.some(([url]) => url === '/customer/auth/register')).toBe(false)
  })

  it('offers the log-in when the email already has an account, keeping the email', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: { errors: { email: ['An account with this email already exists. Log in instead.'] } },
      },
    })
    await completeSignup(user)

    // Moved to the log-in, with the email named back to them and the typed
    // value intact — retyping an address you just typed loses people.
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/already have an account/i)
    expect(screen.getByRole('status')).toHaveTextContent('nakato@example.com')
    expect(screen.getByLabelText(/email address/i)).toHaveValue('nakato@example.com')
    // Password is cleared: it belonged to the account that was not created.
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('')
  })

  it('signs an existing customer in and places the ride on the same tap', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.click(screen.getByRole('button', { name: /^log in$/i }))
    await user.type(screen.getByLabelText(/email address/i), 'nakato@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'kampala-rides-1')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('KR-7XKPQ2')).toBeInTheDocument()
    expect(post.mock.calls.some(([url]) => url === '/customer/auth/login')).toBe(true)

    /*
     * The account that had just signed in must be the one on the order.
     * Submitting straight after authentication reads it from the callback
     * rather than from state, because `adopt` has not re-rendered yet —
     * getting that wrong sends an order with an empty name.
     */
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    expect((order[1] as Record<string, unknown>).contact_name).toBe('Nakato Grace')
    expect((order[1] as Record<string, unknown>).contact_phone).toBe('0700123456')
  })

  it('says so plainly when the credentials do not match an account', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.click(screen.getByRole('button', { name: /^log in$/i }))
    post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401, data: {} } })
    await user.type(screen.getByLabelText(/email address/i), 'nakato@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match an account/i)
  })

  /** Walk to the account step of a ride order. */
  async function reachAccountStep(user: ReturnType<typeof userEvent.setup>) {
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
  }

  it('lets the password be shown, and hides it again', async () => {
    const user = userEvent.setup()
    await reachAccountStep(user)

    const field = screen.getByLabelText(/^password$/i)
    expect(field).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: /show password/i }))
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: /hide password/i }))
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password')
  })

  it('rates the password as it is typed, and stays quiet until it is', async () => {
    const user = userEvent.setup()
    await reachAccountStep(user)

    // Nothing typed, nothing judged.
    expect(screen.queryByText(/password strength/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    expect(await screen.findByText('Weak')).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/^password$/i))
    await user.type(screen.getByLabelText(/^password$/i), 'correct horse battery staple')
    expect(await screen.findByText('Strong')).toBeInTheDocument()
  })

  it('offers the social buttons on the log-in too, not only on sign-up', async () => {
    const user = userEvent.setup()
    await reachAccountStep(user)

    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^log in$/i }))

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /facebook/i })).toBeInTheDocument()
  })

  it('starts on the details step when the hero form prefilled the trip', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')

    // The pickup card summarises the prefilled point; editing reveals the input.
    expect(screen.getByText('Seeta')).toBeInTheDocument()
    expect(screen.getByLabelText(/destination/i)).toHaveValue('Acacia Mall')

    await user.click(screen.getByRole('button', { name: /pickup/i }))
    expect(screen.getByLabelText(/pickup location/i)).toHaveValue('Seeta')
  })

  it('requires rider details for a ride for someone else, and sends them', async () => {
    const user = userEvent.setup()
    mockApi('KR-RIDER1')
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')

    await user.click(screen.getByRole('button', { name: /pickup/i }))
    await user.click(screen.getByRole('radio', { name: /someone else/i }))
    // The dispatcher must be able to reach the rider before this can continue.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/rider's name/i), 'Auma Brenda')
    await user.type(screen.getByLabelText(/rider's phone/i), '0700987654')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Through the vehicle chooser with the default class.
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Sign-up places the ride; there is no confirm screen for a hail.
    await completeSignup(user)

    expect(await screen.findByText('KR-RIDER1')).toBeInTheDocument()
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as { details: Record<string, unknown> }
    expect(payload.details.recipient_name).toBe('Auma Brenda')
    expect(payload.details.recipient_phone).toBe('0700987654')
  })

  it('jumps straight to the vehicle step when a history destination is picked', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'kr.recent-destinations',
      JSON.stringify([{ name: 'Acacia Mall', detail: 'Kampala', count: 3 }]),
    )
    renderOrderPage('/order?service=ride&pickup=Seeta')

    // A known destination needs no search - one tap moves the flow on.
    await user.click(screen.getByRole('button', { name: /acacia mall/i }))
    expect(screen.getByText('Choose a ride')).toBeInTheDocument()
  })

  it('leads delivery with the vehicle, recommended from the package size', async () => {
    const user = userEvent.setup()
    mockApi('KR-DELIV1')
    renderOrderPage('/order?service=delivery')

    // Straight onto the vehicle screen: medium is the default size, so the
    // tricycle arrives preselected - but the sender can overrule it.
    expect(screen.getByRole('radio', { name: /tricycle/i })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: /5 ton/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Locations come after the vehicle, as two stops on one route.
    await user.type(screen.getByLabelText(/pickup location/i), 'Seeta')
    await user.type(screen.getByLabelText(/drop-off location/i), 'Ntinda')
    // Parcel is the default; say it is documents instead.
    await user.click(screen.getByRole('radio', { name: /documents/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await completeSignup(user)
    await user.click(await screen.findByRole('button', { name: /confirm delivery/i }))

    // Who is at each end. The account holder sends; the receiver is new,
    // and the rider cannot be sent to a name without a number.
    expect(await screen.findByText(/sender & recipient/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/receiver's name/i), 'Auma Brenda')
    await user.type(screen.getByLabelText(/receiver's phone/i), '0700987654')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('KR-DELIV1')).toBeInTheDocument()
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as { details: Record<string, unknown> }
    expect(payload.details.package_size).toBe('medium')
    expect(payload.details.delivery_vehicle).toBe('5 Ton')
    expect(payload.details.item_type).toBe('documents')
    // Untouched, the defaults still travel with the order: the rider must
    // be told which end pays, and how the handover is confirmed.
    expect(payload.details.payer).toBe('sender')
    expect(payload.details.payment_method).toBe('cash')
    expect(payload.details.recipient_name).toBe('Auma Brenda')
    expect(payload.details.confirm_with_pin).toBe(true)
  })

  it('confirms a delivery with the payment answered on the summary', async () => {
    const user = userEvent.setup()
    mockApi('KR-DELIV2')
    signedInCustomer()
    renderOrderPage('/order?service=delivery&pickup=Seeta&dropoff=Ntinda')

    // Vehicle (tricycle, recommended for the default medium package), then
    // the route, then the summary — no sign-up for an account holder.
    await user.click(await screen.findByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // The summary reads the order back: the vehicle and its starting fare.
    expect(await screen.findByText(/package summary/i)).toBeInTheDocument()
    expect(screen.getByText('Tricycle')).toBeInTheDocument()
    expect(screen.getByText('UGX 9,000')).toBeInTheDocument()

    // The receiver is paying, by Mobile Money.
    await user.click(screen.getByRole('radio', { name: /receiver/i }))
    await user.selectOptions(screen.getByLabelText(/payment method/i), 'mobile_money')

    // The note is folded away until it is wanted.
    expect(screen.queryByLabelText(/note for the rider/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add a note/i }))
    await user.type(screen.getByLabelText(/note for the rider/i), 'Gate code 4417')

    await user.click(screen.getByRole('button', { name: /confirm delivery/i }))

    // The parties screen, with the receiver named and the PIN turned off.
    await user.type(await screen.findByLabelText(/receiver's name/i), 'Auma Brenda')
    await user.type(screen.getByLabelText(/receiver's phone/i), '0700987654')
    await user.click(screen.getByRole('switch', { name: /confirm delivery with pin/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('KR-DELIV2')).toBeInTheDocument()
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as { details: Record<string, unknown>; notes: string }
    expect(payload.details.payer).toBe('receiver')
    expect(payload.details.payment_method).toBe('mobile_money')
    expect(payload.notes).toBe('Gate code 4417')
    expect(payload.details.recipient_phone).toBe('0700987654')
    expect(payload.details.confirm_with_pin).toBe(false)
    // The sender is the account holder, so no second copy of their details.
    expect(payload.details.sender_name).toBeUndefined()
  })

  it('sends a parcel on behalf of somebody else, naming both ends', async () => {
    const user = userEvent.setup()
    mockApi('KR-DELIV3')
    signedInCustomer()
    renderOrderPage('/order?service=delivery&pickup=Seeta&dropoff=Ntinda')

    await user.click(await screen.findByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('button', { name: /confirm delivery/i }))

    // Neither end is the account holder: a shop owner booking a rider for
    // a customer's parcel. Both names and both numbers are required.
    await user.click(await screen.findByRole('radio', { name: /^someone else$/i }))
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/sender's name/i), 'Okello James')
    await user.type(screen.getByLabelText(/sender's phone/i), '0700111222')
    await user.type(screen.getByLabelText(/receiver's name/i), 'Auma Brenda')
    await user.type(screen.getByLabelText(/receiver's phone/i), '0700987654')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('KR-DELIV3')).toBeInTheDocument()
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as { details: Record<string, unknown> }
    expect(payload.details.sender_name).toBe('Okello James')
    expect(payload.details.sender_phone).toBe('0700111222')
    expect(payload.details.recipient_name).toBe('Auma Brenda')
  })

  it('takes the account for whichever end says "me", so nothing drifts', async () => {
    const user = userEvent.setup()
    mockApi('KR-DELIV4')
    signedInCustomer()
    renderOrderPage('/order?service=delivery&pickup=Seeta&dropoff=Ntinda')

    await user.click(await screen.findByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('button', { name: /confirm delivery/i }))

    // A parcel coming back to the person who booked it: the receiver is
    // the account, read off it rather than retyped into the form.
    const receiverGroup = screen.getByRole('radiogroup', { name: /who is the receiver/i })
    await user.click(within(receiverGroup).getByRole('radio', { name: /^me /i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('KR-DELIV4')).toBeInTheDocument()
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as { details: Record<string, unknown> }
    expect(payload.details.recipient_name).toBe('Nakato Grace')
    expect(payload.details.recipient_phone).toBe('0700123456')
  })

  it('defaults the pickup to the device location, and collapses once it lands', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=delivery')
    await user.click(await screen.findByRole('button', { name: /continue/i }))

    // Resolved from geolocation: labelled "Current location", carrying the
    // address a dispatcher can drive to.
    expect(await screen.findByText('Current location')).toBeInTheDocument()
    expect(screen.getByText('Plot 9, Bukoto Street, Kampala')).toBeInTheDocument()
    // No longer a form — it collapsed on its own when the value arrived.
    expect(screen.queryByLabelText('Pickup location')).not.toBeInTheDocument()
  })

  it('leaves the pickup typeable when the device refuses to locate', async () => {
    const user = userEvent.setup()
    locate.mockResolvedValue(null)
    renderOrderPage('/order?service=delivery')
    await user.click(await screen.findByRole('button', { name: /continue/i }))

    expect(screen.getByLabelText('Pickup location')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use my current location/i })).toBeInTheDocument()
  })

  it('collapses a resolved stop to a place, and reopens it on the pencil', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=delivery')
    await user.click(await screen.findByRole('button', { name: /continue/i }))

    // The located pickup is a resolved place, so it reads as one rather
    // than as a form. Exact labels: the pencil is "Edit pickup location".
    expect(await screen.findByText('Current location')).toBeInTheDocument()
    expect(screen.queryByLabelText('Pickup location')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit pickup location' }))
    expect(screen.getByLabelText('Pickup location')).toHaveValue('Plot 9, Bukoto Street, Kampala')
  })

  it('keeps a free-typed stop editable, so typing is never cut off', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=delivery&dropoff=Ntinda')
    await user.click(await screen.findByRole('button', { name: /continue/i }))

    // Text alone is not a resolved place: the box stays open so the next
    // keystroke lands (collapsing on the first one broke the search).
    const box = screen.getByLabelText('Drop-off location')
    expect(box).toHaveValue('Ntinda')
    await user.type(box, ' Market')
    expect(screen.getByLabelText('Drop-off location')).toHaveValue('Ntinda Market')
  })

  it('walks a self-drive rental through the vehicle catalogue', async () => {
    const user = userEvent.setup()
    mockApi('KR-RENT01')
    renderOrderPage('/order?service=self_drive')

    // A one-day rental: tap the same calendar day twice.
    const now = new Date()
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`
    await user.click(screen.getByRole('button', { name: todayIso }))
    await user.click(screen.getByRole('button', { name: todayIso }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Filter to SUVs; the sedans disappear and nothing is preselected.
    await user.click(screen.getByRole('button', { name: /^suv$/i }))
    expect(screen.queryByText('Toyota Premio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /subaru forester/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await completeSignup(user)

    // A rental hands over a vehicle, so it asks who is taking it. Nothing
    // is submitted until every listed document has been chosen.
    expect(await screen.findByText(/verify your identity/i)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /submit for review/i })
    expect(submit).toBeDisabled()
    // The renter's own papers, and only those: the car is ours, so its
    // logbook and insurance are not theirs to produce.
    expect(screen.queryByText(/vehicle registration/i)).not.toBeInTheDocument()
    for (const label of [/national id/i, /selfie/i, /driver's license/i]) {
      await user.upload(
        screen.getByLabelText(label),
        new File(['x'], 'document.jpg', { type: 'image/jpeg' }),
      )
    }
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    await user.click(await screen.findByRole('button', { name: /place order/i }))

    expect(await screen.findByText('KR-RENT01')).toBeInTheDocument()
    const order = post.mock.calls.find(([url]) => url === '/public/order-requests')!
    const payload = order[1] as { details: Record<string, unknown> }
    expect(payload.details.vehicle_category).toBe('suv')
    expect(payload.details.vehicle_model).toBe('Subaru Forester')
    // The documents themselves stay on the device; what the desk gets is
    // the list of what the renter has to hand.
    expect(payload.details.kyc_documents).toBe('national_id,selfie,drivers_license')
  })

  it('asks a signed-in renter for their documents right after the vehicle', async () => {
    const user = userEvent.setup()
    signedInCustomer()
    renderOrderPage('/order?service=self_drive')

    const now = new Date()
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`
    await user.click(await screen.findByRole('button', { name: todayIso }))
    await user.click(screen.getByRole('button', { name: todayIso }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('radio', { name: /toyota premio/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // No sign-up stands between the vehicle and the identity check.
    expect(await screen.findByText(/verify your identity/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument()

    // A ride and a delivery hand over nothing, so neither is asked.
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText('Pick a vehicle for your trip')).toBeInTheDocument()
  })

  it('never asks a ride or a delivery for identity documents', async () => {
    const user = userEvent.setup()
    signedInCustomer()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')

    await user.click(await screen.findByRole('button', { name: /continue/i }))
    expect(await screen.findByRole('button', { name: /request ride/i })).toBeInTheDocument()
    expect(screen.queryByText(/verify your identity/i)).not.toBeInTheDocument()
  })

  it('requires an account before an order can be placed', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // ADR-0015 §1 replaced ADR-0012 §3's anonymous contact step: there is
    // no way past this screen that does not create or resume an account.
    expect(screen.getByText('Create your account')).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /place order/i })).not.toBeInTheDocument()
  })

  it('will not continue without pickup and drop-off for a ride', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride')

    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/pickup location/i), 'Seeta')
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  /**
   * Auth succeeds, the order write fails. Set before the sign-up, because
   * for a ride those are the same tap — a plain `mockRejectedValueOnce`
   * would reject the registration instead of the order.
   */
  function failOrderWith(rejection: unknown) {
    post.mockImplementation(async (url: string) => {
      if (url.startsWith('/customer/auth/')) {
        return { data: { data: { customer: CUSTOMER, token: 'customer-token' } } }
      }
      throw rejection
    })
  }

  it('explains a rejected account detail rather than looping back to a form', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // The contact fields are the account's now, so there is no earlier
    // step holding them — bouncing back to one would be a loop.
    failOrderWith({
      isAxiosError: true,
      response: { status: 422, data: { errors: { contact_phone: ['Give us a phone number.'] } } },
    })
    await completeSignup(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/account details were rejected/i)
    // A hail that failed falls back to the summary, so it can be retried
    // without re-entering anything — the account was created either way.
    expect(screen.getByRole('button', { name: /place order/i })).toBeInTheDocument()
  })

  it('explains a 429 in words rather than an error code', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    failOrderWith({ isAxiosError: true, response: { status: 429, data: {} } })
    await completeSignup(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a minute/i)
  })
})
