import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../../test/harness'
import { OnboardClientDialog } from './OnboardClientDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

const FLEET = makeUser({ role: 'super_admin', access_level: 'fleet', tenant_id: null })
const HEAD_OFFICE = makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null })

function lookup(exists: boolean) {
  get.mockImplementation((url: string) => {
    if (url.includes('/clients/lookup')) return Promise.resolve(apiOk({ exists }))
    return Promise.resolve(apiOk([{ id: 1, name: 'Shanitah', slug: 'shanitah', status: 'active', is_active: true, created_at: null }]))
  })
}

beforeEach(() => vi.clearAllMocks())

/**
 * ADR-0060 §2 asks for the number **first**, because a form that asks last is
 * one where somebody types the whole profile, hits save, is told the company
 * exists — and the easiest workaround at that moment is a slightly different
 * spelling of the name.
 *
 * This used to assert that every other field was **disabled** until the lookup
 * answered, and that is what shipped. In a browser it read as a broken form:
 * the owner clicked "Served by", nothing happened, and reported the picker as
 * faulty twice. `Select` cannot show a fieldset's disabled state — its shell
 * paints from its own prop — but even fixed, a form whose fields go dead in a
 * particular order is a form people fight.
 *
 * So the ordering is kept and the disabling is gone. What the ADR was actually
 * protecting is asserted in the two tests below: the number is looked up live,
 * the answer is shown before anybody types a profile, and onboarding is
 * refused while it is taken.
 */
it('asks for the number first and leaves the rest of the form usable', async () => {
  lookup(false)
  renderAs(<OnboardClientDialog onClose={vi.fn()} onDone={vi.fn()} />, FLEET)

  // The first field, and reachable straight away — as is everything else.
  const inputs = Array.from(document.querySelectorAll('input'))
  expect(inputs[0]).toBe(screen.getByLabelText(/registration number/i))
  expect(screen.getByLabelText(/legal name/i)).toBeEnabled()

  await userEvent.type(screen.getByLabelText(/registration number/i), 'UG-REG-88214')

  await waitFor(() => expect(screen.getByText(/not on kangaru yet/i)).toBeInTheDocument())
})

/**
 * The whole of path B's disclosure rule, on the screen: the fleet is told the
 * number is taken and **nothing about the client**.
 */
it('tells a fleet the number is taken, and nothing whatever about them', async () => {
  lookup(true)
  renderAs(<OnboardClientDialog onClose={vi.fn()} onDone={vi.fn()} />, FLEET)

  await userEvent.type(screen.getByLabelText(/registration number/i), 'UG-REG-88214')

  expect(await screen.findByText(/already have an account/i)).toBeInTheDocument()
  // Onboarding is off the table; asking is what is left.
  expect(screen.getByRole('button', { name: /request to serve them/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^onboard client$/i })).not.toBeInTheDocument()
})

it('sends the request rather than creating anything', async () => {
  lookup(true)
  post.mockResolvedValue(apiOk({}))
  renderAs(<OnboardClientDialog onClose={vi.fn()} onDone={vi.fn()} />, FLEET)

  await userEvent.type(screen.getByLabelText(/registration number/i), 'UG-REG-88214')
  await userEvent.click(await screen.findByRole('button', { name: /request to serve them/i }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/contracts', { registration_number: 'UG-REG-88214' }),
  )
  expect(post).not.toHaveBeenCalledWith('/companies', expect.anything())
})

/** ADR-0062 §3: required, not defaulted. */
it('makes head office choose a fleet, and does not ask a fleet to', async () => {
  lookup(false)
  renderAs(<OnboardClientDialog onClose={vi.fn()} onDone={vi.fn()} />, HEAD_OFFICE)
  await userEvent.type(screen.getByLabelText(/registration number/i), 'UG-REG-00001')

  expect(await screen.findByLabelText(/served by/i)).toBeInTheDocument()
})

it('does not ask a fleet which fleet it means', async () => {
  lookup(false)
  renderAs(<OnboardClientDialog onClose={vi.fn()} onDone={vi.fn()} />, FLEET)
  await userEvent.type(screen.getByLabelText(/registration number/i), 'UG-REG-00001')

  await waitFor(() => expect(screen.getByLabelText(/legal name/i)).toBeEnabled())
  expect(screen.queryByLabelText(/served by/i)).not.toBeInTheDocument()
})
