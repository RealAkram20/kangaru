import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MapRecenterButton } from './MapRecenterButton'

/**
 * The button, on its own.
 *
 * Its wiring cannot be tested where it lives: jsdom has no WebGL context, so
 * every map in this codebase is replaced by a stub in the tests of the pages
 * that draw it (`LiveMapPage.test.tsx` says so in as many words). What *is*
 * testable — and what actually breaks — is the part a screen reader depends
 * on: the crosshair is the entire button, so the label is the only thing
 * that says what pressing it will do.
 */
describe('MapRecenterButton', () => {
  it('is named by what it puts back, since the glyph says nothing', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()

    render(<MapRecenterButton label="Show the whole fleet" onClick={onClick} />)

    // Found by its accessible name, not by a test id: that is the same
    // lookup an assistive technology performs, so a button that passes here
    // is a button somebody can find.
    await user.click(screen.getByRole('button', { name: 'Show the whole fleet' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('still says something when the caller names nothing', () => {
    render(<MapRecenterButton onClick={() => {}} />)

    expect(screen.getByRole('button', { name: 'Recentre the map' })).toBeInTheDocument()
  })
})
