import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Company } from '../../types/company'
import { apiFailure, apiOk, makeUser, renderAs } from '../../test/harness'
import { EditClientDialog } from './EditClientDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const patch = vi.mocked(apiClient.patch)

const HEAD_OFFICE = makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null })

const CLIENT: Company = {
  id: 7,
  tenant_id: 3,
  legal_name: 'Centenary Rural Development Bank',
  trading_name: 'Centenary Bank',
  registration_number: 'UG-REG-88214',
  industry: null,
  billing_email: 'accounts@centenary.test',
  phone: null,
  address_line1: null,
  address_line2: null,
  city: 'Kampala',
  country: 'UG',
  credit_limit_minor: 0,
  status: 'active',
  created_at: '2026-08-01T00:00:00.000000Z',
  updated_at: '2026-08-01T00:00:00.000000Z',
}

beforeEach(() => vi.clearAllMocks())

function open() {
  const onDone = vi.fn()
  renderAs(<EditClientDialog client={CLIENT} onClose={vi.fn()} onDone={onDone} />, HEAD_OFFICE)
  return onDone
}

it('opens on what the client actually holds, rather than on an empty form', async () => {
  open()

  expect(await screen.findByLabelText(/legal name/i)).toHaveValue(CLIENT.legal_name)
  expect(screen.getByLabelText(/registration number/i)).toHaveValue(CLIENT.registration_number)
  expect(screen.getByLabelText(/billing email/i)).toHaveValue(CLIENT.billing_email)
})

/**
 * The save button is the whole of the "nothing to do" state. A dialog that
 * offers to save an untouched form invites a request that can only fail or do
 * nothing, and on this endpoint it can do worse — see the next test.
 */
it('offers nothing to save until something has actually changed', async () => {
  open()

  const save = await screen.findByRole('button', { name: /save changes/i })
  expect(save).toBeDisabled()

  await userEvent.type(screen.getByLabelText(/^city/i), 'x')

  await waitFor(() => expect(save).toBeEnabled())
})

/**
 * The reason `changed` exists at all.
 *
 * `UpdateCompanyRequest` validates `registration_number` as unique-ignoring-
 * self, so re-sending an unchanged one is harmless *today*. It is one
 * `ignore()` away from refusing an edit that changed only the city — and the
 * failure would name a field the person never touched. Sending only what moved
 * is what makes that class of confusion impossible rather than merely absent.
 */
it('sends only the fields that moved, not the whole form', async () => {
  patch.mockResolvedValue(apiOk({ ...CLIENT, city: 'Entebbe' }))
  open()

  const city = await screen.findByLabelText(/^city/i)
  await userEvent.clear(city)
  await userEvent.type(city, 'Entebbe')
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
  // The exact body, not a subset match: `toMatchObject` would pass just as
  // happily on a payload carrying all six fields, which is the thing this
  // test exists to rule out.
  expect(patch).toHaveBeenCalledWith('/companies/7', { city: 'Entebbe' })
})

/**
 * An emptied optional field means "not recorded", and the column is nullable
 * so that it can say so. Sending `''` would store an empty string, and the
 * directory's em-dash placeholder would quietly stop appearing.
 */
it('clears an optional field to null rather than to an empty string', async () => {
  patch.mockResolvedValue(apiOk({ ...CLIENT, trading_name: null }))
  open()

  await userEvent.clear(await screen.findByLabelText(/trading name/i))
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

  await waitFor(() => expect(patch).toHaveBeenCalledWith('/companies/7', { trading_name: null }))
})

/**
 * ADR-0060 §1: the registration number is the client's platform identity, so a
 * collision has to arrive under the field rather than as a banner nobody can
 * act on. It used to arrive as an integrity-constraint 500.
 */
it('puts a taken registration number under the field that caused it', async () => {
  patch.mockRejectedValue(
    apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
      registration_number: ['The registration number has already been taken.'],
    }),
  )
  open()

  const reg = await screen.findByLabelText(/registration number/i)
  await userEvent.clear(reg)
  await userEvent.type(reg, 'UG-REG-00001')
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

  expect(await screen.findByText(/already been taken/i)).toBeInTheDocument()
})

/**
 * ADR-0062. Head office reads the directory, not the operations — and writes
 * the same half. A credit limit is a fleet's judgement about its customer and
 * suspending a client stops them booking, which is the fleet's call with its
 * own customer.
 *
 * Asserted as an absence because an absence is what regresses silently: adding
 * a field to this form is one line, and nothing else in the codebase would
 * complain.
 */
it('offers head office no control over the credit limit or the status', async () => {
  open()

  await screen.findByLabelText(/legal name/i)
  expect(screen.queryByLabelText(/credit limit/i)).toBeNull()
  expect(screen.queryByLabelText(/status/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull()
})
