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
})

describe('OrderPage', () => {
  it('walks a ride order from service to reference', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ data: { data: { reference: 'KR-7XKPQ2' } } })

    renderOrderPage()

    await user.click(screen.getByRole('button', { name: /ride/i }))

    await user.type(screen.getByLabelText(/pickup location/i), 'Bukerere Rd, Kampala')
    await user.type(screen.getByLabelText(/destination/i), 'Acacia Mall')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.type(screen.getByLabelText(/your name/i), 'Nakato Grace')
    await user.type(screen.getByLabelText(/phone number/i), '0700123456')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Review shows what will be sent, then the submit fires exactly once.
    expect(screen.getByText('Bukerere Rd, Kampala')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByText('KR-7XKPQ2')).toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(1)

    const payload = post.mock.calls[0][1] as Record<string, unknown>
    expect(payload.service_type).toBe('ride')
    expect(payload.contact_phone).toBe('0700123456')
    // The honeypot stays home when a human fills the form.
    expect(payload.website).toBeUndefined()
  })

  it('starts on the details step when the hero form prefilled the trip', () => {
    renderOrderPage('/order?service=ride&pickup=Seeta&dropoff=Acacia+Mall')

    expect(screen.getByLabelText(/pickup location/i)).toHaveValue('Seeta')
    expect(screen.getByLabelText(/destination/i)).toHaveValue('Acacia Mall')
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
    await user.type(screen.getByLabelText(/your name/i), 'Okello James')
    await user.type(screen.getByLabelText(/phone number/i), '123456789')
    await user.click(screen.getByRole('button', { name: /continue/i }))
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
    await user.type(screen.getByLabelText(/your name/i), 'Okello James')
    await user.type(screen.getByLabelText(/phone number/i), '0700123456')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /place order/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a minute/i)
  })
})
