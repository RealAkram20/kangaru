import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

/**
 * A dialog taller than the viewport has to be reachable.
 *
 * This was a live blocker: the panel had `overflow: hidden` and no
 * `max-height`, inside a `position: fixed` overlay. A long form therefore grew
 * past the screen and the overflowing part could not be reached at all — no
 * page scroll, no dialog scroll, and the footer's primary button off-screen.
 *
 * The rate card version form found it, but nothing about the bug was specific
 * to that form; every dialog in the app was one long body away from it.
 */
it('bounds its height and scrolls the body rather than clipping it', () => {
  render(
    <Dialog title="Tall" onClose={vi.fn()} footer={<button>Save</button>}>
      <p>Body</p>
    </Dialog>,
  )

  const panel = screen.getByRole('dialog')

  // Bounded, and a column — so the body can be the only part that scrolls.
  expect(panel.style.maxHeight).toBe('100%')
  expect(panel.style.flexDirection).toBe('column')

  const body = screen.getByText('Body').parentElement as HTMLElement

  expect(body.style.overflowY).toBe('auto')
  // `min-height: auto` is a flex item's default and refuses to shrink below
  // its content, which would push the panel past `max-height` and clip exactly
  // as before. This one property is what makes the rest work.
  expect(body.style.minHeight).toBe('0px')
})

it('keeps the footer reachable without scrolling to it', () => {
  render(
    <Dialog title="Tall" onClose={vi.fn()} footer={<button>Save</button>}>
      <p>Body</p>
    </Dialog>,
  )

  const footer = screen.getByRole('button', { name: 'Save' }).parentElement as HTMLElement

  // `0 0 auto`: the primary action must not be something a finance officer has
  // to scroll a six-category form to the bottom to find.
  expect(footer.style.flex).toBe('0 0 auto')
})
