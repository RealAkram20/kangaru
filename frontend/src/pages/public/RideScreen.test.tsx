import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RideScreen } from './RideScreen'
import { simulatedRideSource } from './ride'

/**
 * The matching timeline is driven by timers, so every case here drives the
 * clock rather than waiting on it. MapPanel renders its keyless iframe
 * fallback under MODE=test, so no GL context is needed.
 */
function renderMatching(reference = 'KR-7XKPQ2') {
  const near: [number, number] = [32.5825, 0.3476]

  return render(
    <MemoryRouter>
      <RideScreen
        reference={reference}
        pickup="Plot 9, Bukoto Street"
        dropoff="Acacia Mall"
        near={near}
        from={null}
        to={null}
        /*
         * The simulation, injected.
         *
         * Since ADR-0024 the app's own `createRideSource` polls the real
         * `/customer/rides/active`, which this suite has no server for — and
         * should not, because what it tests is the *screen*: that a captain
         * appears when one is assigned, that the fare breaks itself down,
         * that a rating is asked for last. The simulation is the only source
         * that can drive that whole timeline on a clock the test controls.
         *
         * The live source has its own coverage of what it maps and what it
         * refuses to invent.
         */
        source={simulatedRideSource(reference, near, null)}
      />
    </MemoryRouter>,
  )
}

/** Advance both the timers and the Date the progress ramp reads. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RideScreen', () => {
  it('opens on the search, not on a captain it does not have yet', () => {
    renderMatching()

    expect(screen.getByRole('heading', { name: 'Finding you a captain' })).toBeInTheDocument()
    expect(screen.getByText('Contacting captains nearby.')).toBeInTheDocument()
    // Nothing may claim a distance before there is anyone to be distant.
    expect(screen.queryByText(/km away/)).not.toBeInTheDocument()
  })

  it('names the captain as soon as the search ends, with no waiting state', () => {
    renderMatching()
    advance(4300)

    // Automatic dispatch has already chosen and connected somebody, so the
    // first thing after the search is who — not another wait.
    // The headline is the captain's ETA, which is the thing being waited on.
    expect(screen.getByRole('heading', { name: /your captain arrives in \d+ min/i })).toBeInTheDocument()
    expect(screen.queryByText(/waiting for captain to accept/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Captain found' })).not.toBeInTheDocument()
  })

  it('goes on to a confirmed captain with the details to identify them', () => {
    renderMatching()
    advance(4300)

    expect(screen.getByRole('heading', { name: /your captain arrives in \d+ min/i })).toBeInTheDocument()
    // Plate, colour and model are how a customer picks the car out.
    expect(screen.getByText(/^U[A-Z]{2} \d{3}[A-Z]$/)).toBeInTheDocument()
    expect(screen.getByText(/Toyota|Nissan/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /contact captain/i })).toHaveAttribute('href', expect.stringContaining('tel:'))
    expect(screen.getByRole('link', { name: /message captain/i })).toHaveAttribute('href', expect.stringContaining('sms:'))
    // The rail belonged to the search. Once somebody is coming, a full bar
    // says nothing — the ETA is the thing worth watching, so the rail goes.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('counts the captain down, then says they are here', () => {
    renderMatching()
    advance(8000)

    expect(screen.getByRole('heading', { name: /your captain arrives in \d+ min/i })).toBeInTheDocument()

    advance(13_000)
    expect(screen.getByRole('heading', { name: 'Your Captain is here' })).toBeInTheDocument()
    // The plate is how you pick the car out of a row of them at the kerb.
    expect(screen.getByText(/^U[A-Z]{2} \d{3}[A-Z]$/)).toBeInTheDocument()
  })

  it('carries on through the trip to a fare that breaks itself down', () => {
    renderMatching()
    advance(45_000)

    expect(screen.getByRole('heading', { name: 'Trip complete' })).toBeInTheDocument()
    // The total, the three lines that make it up, and nothing rounded away.
    expect(screen.getAllByText(/^UGX [\d,]+$/).length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText(/Base fare/)).toBeInTheDocument()
    expect(screen.getByText(/Distance ·/)).toBeInTheDocument()
    expect(screen.getByText(/Time ·/)).toBeInTheDocument()
    // Cash is the default here, and it settles with the captain, not us.
    expect(screen.getByRole('button', { name: /i have paid/i })).toBeInTheDocument()
  })

  it('asks for a rating only after the fare is settled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderMatching()
    advance(45_000)

    expect(screen.queryByRole('button', { name: /submit rating/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /i have paid/i }))

    expect(screen.getByText(/how was your trip/i)).toBeInTheDocument()
    // No stars, no submit: a blank rating is not a rating.
    expect(screen.getByRole('button', { name: /submit rating/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '4 stars' }))
    expect(screen.getByRole('button', { name: /submit rating/i })).toBeEnabled()
  })

  it('lets the ride be cancelled, and asks why', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderMatching()
    advance(4300)

    await user.click(screen.getByRole('button', { name: /cancel trip/i }))
    await user.click(screen.getByRole('button', { name: 'I found another ride' }))

    expect(screen.getByRole('heading', { name: 'Ride cancelled' })).toBeInTheDocument()
    expect(screen.getByText(/nothing has been charged/i)).toBeInTheDocument()
    expect(screen.getByText(/I found another ride/)).toBeInTheDocument()
    // Cancelling is gone once there is no ride left to cancel.
    expect(screen.queryByRole('button', { name: /cancel trip/i })).not.toBeInTheDocument()
  })

  it('strips the trip screen to the map, the captain and a way out', () => {
    renderMatching()
    advance(25_000)

    expect(screen.getByRole('heading', { name: 'On your trip' })).toBeInTheDocument()
    // Somebody in a moving car needs out more than somebody at the kerb.
    expect(screen.getByRole('button', { name: /cancel trip/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /contact captain/i })).toBeInTheDocument()

    // The route cannot be edited from a moving car and the fare is already
    // agreed, so neither card earns the space the map wants.
    expect(screen.queryByRole('heading', { name: 'My destination' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Payment method' })).not.toBeInTheDocument()
    expect(screen.queryByText(/add stop/i)).not.toBeInTheDocument()
    // The captain is a strip by now, not the full card: the plate has
    // already done its job of finding the car.
    expect(screen.queryByRole('button', { name: /share your trip/i })).not.toBeInTheDocument()
  })

  it('lets a good captain be saved for next time, and unsaved again', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderMatching()
    advance(25_000)

    const save = screen.getByRole('button', { name: /save .* as a favourite/i })
    expect(save).toHaveAttribute('aria-pressed', 'false')

    await user.click(save)
    expect(
      screen.getByRole('button', { name: /remove .* from favourites/i }),
    ).toHaveAttribute('aria-pressed', 'true')
    // Saved on the device, so it is still there on the next ride.
    expect(JSON.parse(localStorage.getItem('kr.favourite-captains')!)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /remove .* from favourites/i }))
    expect(JSON.parse(localStorage.getItem('kr.favourite-captains')!)).toHaveLength(0)
  })

  it('keeps a way to reach the captain from inside the car', () => {
    renderMatching()
    advance(25_000)

    // Trimmed hard, but not this: losing contact with your driver mid-trip
    // is a safety regression rather than a tidy-up.
    expect(screen.getByRole('link', { name: /contact captain/i })).toHaveAttribute(
      'href',
      expect.stringContaining('tel:'),
    )
  })

  it('matches the same captain to the same reference every time', () => {
    const first = renderMatching('KR-STABLE')
    advance(4300)
    const plate = screen.getByText(/^U[A-Z]{2} \d{3}[A-Z]$/).textContent
    first.unmount()

    renderMatching('KR-STABLE')
    advance(4300)

    expect(screen.getByText(/^U[A-Z]{2} \d{3}[A-Z]$/)).toHaveTextContent(plate!)
  })

  it('keeps the reference and the trip readable through every phase', () => {
    renderMatching('KR-7XKPQ2')

    for (const atMs of [0, 4300, 4200]) {
      advance(atMs)
      // The reference is what a customer quotes if the match falls over.
      expect(screen.getByText('KR-7XKPQ2')).toBeInTheDocument()
      expect(screen.getByText('Plot 9, Bukoto Street')).toBeInTheDocument()
      expect(screen.getByText('Acacia Mall')).toBeInTheDocument()
    }
  })
})
