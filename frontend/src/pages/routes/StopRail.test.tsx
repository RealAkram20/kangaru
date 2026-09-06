import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { StopRail } from './StopRail'
import { draftStop, type ClientPlace, type DraftStop } from './routeBuilder'

/**
 * The itinerary rail (ADR-0045).
 *
 * **A pointer drag is not testable in jsdom** — `@dnd-kit`'s PointerSensor
 * needs real pointer events with coordinates and a layout engine to hit-test
 * against, and jsdom has neither. Faking one would test the fake.
 *
 * So what is pinned here is the half that a broken drag would leave behind
 * anyway, and the half WCAG AA actually requires: that every stop can be
 * moved **without a mouse at all**, that each control says which stop it
 * moves, and that the ends of the list are closed rather than silently
 * no-op. The drag path shares `reorder()` with these buttons, and
 * `routeBuilder.test.ts` pins that.
 */

function place(id: number, name: string): ClientPlace {
  return {
    id,
    name,
    address: null,
    latitude: 0.31,
    longitude: 32.58,
    arrival_radius_m: null,
    notes: null,
    is_active: true,
  }
}

function Harness({ initial }: { initial: string[] }) {
  // Ids are assigned per *name*, so a name repeated in `initial` is the same
  // `client_place` visited twice — which is the case the last test is about.
  const [stops, setStops] = useState<DraftStop[]>(() => {
    const ids = new Map<string, number>()

    return initial.map((name) => {
      if (!ids.has(name)) ids.set(name, ids.size + 1)

      return draftStop(place(ids.get(name) ?? 0, name))
    })
  })

  return (
    <StopRail
      stops={stops}
      onChange={setStops}
      onRemove={(key) => setStops((current) => current.filter((stop) => stop.key !== key))}
    />
  )
}

/** The rail's rendered order, read the way a person reads it. */
function order(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
    .map((text) => text.replace(/\d+/g, '').trim())
}

describe('StopRail', () => {
  it('moves a stop down with the keyboard alone, and renumbers as it goes', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['Head Office', 'Nakawa ATM', 'Wandegeya ATM']} />)

    expect(order()).toEqual(['Head Office', 'Nakawa ATM', 'Wandegeya ATM'])

    await user.click(screen.getByRole('button', { name: 'Move Head Office down' }))

    expect(order()).toEqual(['Nakawa ATM', 'Head Office', 'Wandegeya ATM'])

    // The badge follows the position, not the stop: Head Office is now 2.
    const second = screen.getAllByRole('listitem')[1]
    expect(second.textContent).toContain('2')
    expect(second.textContent).toContain('Head Office')
  })

  it('closes the ends of the list rather than offering a move that does nothing', () => {
    render(<Harness initial={['First', 'Last']} />)

    // Disabled rather than hidden: a control that vanishes at the boundary
    // moves every other control under the officer's cursor as they work.
    expect(screen.getByRole('button', { name: 'Move First up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Last down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move First down' })).toBeEnabled()
  })

  it('names the stop in every control, so the list is usable one row at a time', () => {
    render(<Harness initial={['Nakawa ATM', 'Wandegeya ATM']} />)

    // A screen reader reads these one at a time with no visual context. "Move
    // up" three times over is a list nobody can navigate by ear.
    expect(
      screen.getByRole('button', { name: 'Reorder Nakawa ATM, currently stop 1 of 2' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Nakawa ATM from this route' }),
    ).toBeInTheDocument()
  })

  it('removes the stop the officer asked for and not the one beside it', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['Head Office', 'Nakawa ATM', 'Wandegeya ATM']} />)

    await user.click(screen.getByRole('button', { name: 'Remove Nakawa ATM from this route' }))

    expect(order()).toEqual(['Head Office', 'Wandegeya ATM'])
  })

  it('says what an empty route is for instead of rendering a blank panel', () => {
    render(<Harness initial={[]} />)

    expect(screen.getByText('No stops yet')).toBeInTheDocument()
    expect(screen.getByText(/Search for a place below/)).toBeInTheDocument()
  })

  it('keeps both rows draggable when one place is visited twice', () => {
    // Head office at both ends of a cash run: two list items, two distinct
    // reorder handles. A rail keyed by place id would render one.
    render(<Harness initial={['Head Office', 'ATM', 'Head Office']} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(
      screen.getByRole('button', { name: 'Reorder Head Office, currently stop 1 of 3' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reorder Head Office, currently stop 3 of 3' }),
    ).toBeInTheDocument()
  })
})
