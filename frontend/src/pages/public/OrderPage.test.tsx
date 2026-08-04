import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const post = vi.mocked(apiClient.post)

const { OrderPage } = await import('./OrderPage')

function renderOrderPage(url = '/order') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <OrderPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  post.mockReset()
  localStorage.clear()
})

/** Fill the contact step (name, phone, optional email) and continue. */
async function completeContact(user: ReturnType<typeof userEvent.setup>, phone = '0700123456') {
  await user.type(screen.getByLabelText(/full name/i), 'Nakato Grace')
  await user.type(screen.getByLabelText(/phone number/i), phone)
  await user.type(screen.getByLabelText(/email address/i), 'nakato@example.com')
  await user.click(screen.getByRole('button', { name: /continue/i }))
}

describe('OrderPage', () => {
  it('walks a ride order from service to reference', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ data: { data: { reference: 'KR-7XKPQ2' } } })

    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))

    await user.type(screen.getByLabelText(/pickup location/i), 'Bukerere Rd, Kampala')
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // The vehicle chooser: swap the default Economy for a boda.
    await user.click(screen.getByRole('radio', { name: /boda boda/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // The contact step: no account, no password — just what the dispatcher's
    // phone call needs. Locked until the phone number is reachable.
    await user.type(screen.getByLabelText(/full name/i), 'Nakato Grace')
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/phone number/i), '0700123456')
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
    await user.type(screen.getByLabelText(/email address/i), 'nakato@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Review shows what will be sent, then the submit fires exactly once.
    expect(screen.getByText('Bukerere Rd, Kampala')).toBeInTheDocument()
    expect(screen.getByText('Boda Boda')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByText('KR-7XKPQ2')).toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(1)

    const payload = post.mock.calls[0][1] as Record<string, unknown>
    expect(payload.service_type).toBe('ride')
    expect(payload.contact_phone).toBe('0700123456')
    expect((payload.details as Record<string, unknown>).vehicle_class).toBe('boda')
    // The honeypot stays home when a human fills the form.
    expect(payload.website).toBeUndefined()
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
    post.mockResolvedValue({ data: { data: { reference: 'KR-RIDER1' } } })
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

    await completeContact(user)
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByText('KR-RIDER1')).toBeInTheDocument()
    const payload = post.mock.calls[0][1] as { details: Record<string, unknown> }
    expect(payload.details.recipient_name).toBe('Auma Brenda')
    expect(payload.details.recipient_phone).toBe('0700987654')
  })

  it('jumps straight to the contact step when a history destination is picked', async () => {
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
    post.mockResolvedValue({ data: { data: { reference: 'KR-DELIV1' } } })
    renderOrderPage('/order?service=delivery')

    // Straight onto the vehicle screen: medium is the default size, so the
    // tricycle arrives preselected - but the sender can overrule it.
    expect(screen.getByRole('radio', { name: /tricycle/i })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: /5 ton/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Locations come after the vehicle.
    await user.type(screen.getByLabelText(/pickup location/i), 'Seeta')
    await user.type(screen.getByLabelText(/drop-off location/i), 'Ntinda')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await completeContact(user)
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByText('KR-DELIV1')).toBeInTheDocument()
    const payload = post.mock.calls[0][1] as { details: Record<string, unknown> }
    expect(payload.details.package_size).toBe('medium')
    expect(payload.details.delivery_vehicle).toBe('5 Ton')
  })

  it('walks a self-drive rental through the vehicle catalogue', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ data: { data: { reference: 'KR-RENT01' } } })
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

    await completeContact(user)
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByText('KR-RENT01')).toBeInTheDocument()
    const payload = post.mock.calls[0][1] as { details: Record<string, unknown> }
    expect(payload.details.vehicle_category).toBe('suv')
    expect(payload.details.vehicle_model).toBe('Subaru Forester')
  })

  it('asks for contact details, never a password or an account', async () => {
    const user = userEvent.setup()
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // A contact step, deliberately not a signup (ADR-0012 §3): no
    // customer-auth endpoint exists, so nothing here may collect a
    // credential or promise an account.
    expect(screen.getByText('How do we reach you?')).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign up|log in/i })).not.toBeInTheDocument()
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

  it('sends the visitor back to the failing step with the server message on 422', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          errors: { contact_phone: ['Please give us a phone number.'] },
        },
      },
    })

    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    // Vehicle chooser sits between details and contact for rides.
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await completeContact(user, '123456789')
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByText('Please give us a phone number.')).toBeInTheDocument()
    // Back on the contact step, not stranded on review.
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument()
  })

  it('explains a 429 in words rather than an error code', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue({ isAxiosError: true, response: { status: 429, data: {} } })

    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    // Vehicle chooser sits between details and contact for rides.
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await completeContact(user)
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a minute/i)
  })
})
