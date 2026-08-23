import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/apiClient'
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
  /**
   * The whole feature, mounted the way the app mounts it: no injected source,
   * so this drives `createRideSource` → `liveRideSource` → the real poll, and
   * wrapped in StrictMode because `main.tsx` is.
   *
   * Every other case here injects the simulation into a bare `render`, and
   * that is why the reported bug got through with a green suite. The driver
   * accepted, the server answered `accepted` with a captain, and the
   * passenger's screen said "Finding you a captain" until they gave up:
   * StrictMode's mount → cleanup → mount tore the poll down before its first
   * response and the old source never restarted it.
   *
   * `test/harness.tsx` says the same thing about `useNotifications` — "every
   * test passed; the browser showed a spinner". Same shape, same cost.
   */
  it('shows the captain once the driver accepts, mounted as the app mounts it', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        data: {
          reference: 'KR-C5DBWK',
          service_type: 'ride',
          phase: 'accepted',
          pickup: { label: 'Plot 9, Bukoto Street', latitude: 0.3476, longitude: 32.5825 },
          dropoff: { label: 'Acacia Mall', latitude: null, longitude: null },
          trip_id: 14,
          captain: {
            name: 'Demo Driver',
            phone: '+256700000072',
            phone_label: 'Demo Driver',
            vehicle: 'Bajaj Boxer',
            plate: 'UEB 001B',
            vehicle_colour: null,
          },
          created_at: '2026-08-09T20:30:51.000Z',
        },
      },
    })

    render(
      <StrictMode>
        <MemoryRouter>
          <RideScreen
            reference="KR-C5DBWK"
            pickup="Plot 9, Bukoto Street"
            dropoff="Acacia Mall"
            near={[32.5825, 0.3476]}
            from={null}
            to={null}
          />
        </MemoryRouter>
      </StrictMode>,
    )

    // The plate, because that is what the passenger is looking for at a kerb
    // — and the card renders only the captain's first name beside the rating.
    await waitFor(() => expect(screen.getByText('UEB 001B')).toBeInTheDocument())

    // `vehicle_colour` is null above, as it is on a real walk-in vehicle
    // nobody recorded a colour for — and the card used to interpolate it
    // regardless, printing "Bajaj Boxer, " with a comma trailing off the end
    // of the line. Asserted exactly, because a substring match on the model
    // passes either way and is how this shipped.
    expect(screen.getByText('Bajaj Boxer')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Contact Captain' })).toHaveAttribute(
      'href',
      'tel:+256700000072',
    )

    // The search is over, and the screen must say so rather than leaving the
    // rail running underneath the captain it has just been given.
    expect(
      screen.queryByRole('heading', { name: 'Finding you a captain' }),
    ).not.toBeInTheDocument()
  })

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

  it('confirms the rating only after the source recorded it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderMatching()
    advance(45_000)

    await user.click(screen.getByRole('button', { name: /i have paid/i }))
    await user.click(screen.getByRole('button', { name: '4 stars' }))
    await user.click(screen.getByRole('button', { name: /submit rating/i }))

    // The confirmation is the platform's answer, not a local flag: the
    // simulation's rate() resolves recorded, and only then does this render.
    expect(await screen.findByText(/you rated \w+ 4 stars/i)).toBeInTheDocument()
  })

  it('keeps the stars on screen and says why when the rating is refused', async () => {
    // The bug this guards against: "Submit rating" used to flip a local
    // flag, the card thanked the passenger, and nothing had been recorded
    // anywhere — the owner rated a real ride and the driver never got it.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const source = simulatedRideSource('KR-7XKPQ2', [32.5825, 0.3476], null)
    vi.spyOn(source, 'rate').mockResolvedValue({
      recorded: false,
      message: 'You can rate a ride once it has been completed.',
    })

    render(
      <MemoryRouter>
        <RideScreen
          reference="KR-7XKPQ2"
          pickup="Plot 9, Bukoto Street"
          dropoff="Acacia Mall"
          near={[32.5825, 0.3476]}
          from={null}
          to={null}
          source={source}
        />
      </MemoryRouter>,
    )
    advance(45_000)

    await user.click(screen.getByRole('button', { name: /i have paid/i }))
    await user.click(screen.getByRole('button', { name: '5 stars' }))
    await user.click(screen.getByRole('button', { name: /submit rating/i }))

    // The refusal, verbatim; the stars still there to try again; and no
    // thank-you card for a rating that went nowhere.
    expect(await screen.findByText('You can rate a ride once it has been completed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit rating/i })).toBeInTheDocument()
    expect(screen.queryByText(/you rated/i)).not.toBeInTheDocument()
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
