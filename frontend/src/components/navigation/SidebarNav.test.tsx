import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SidebarNav } from './SidebarNav'

/**
 * The identity card under the logo looked like a control and was a plain
 * `<div>` — the same defect the topbar avatar had before UserMenu. It is now
 * the door to your own Profile, so these assert it is a real button rather
 * than a div with a click handler, and that it stays inert for the callers
 * (the design-system previews) that have nowhere to send it.
 */
const user = { name: 'Ada Nakato', role: 'Super Admin' }

const card = () => screen.getByRole('button', { name: /ada nakato — your profile/i })

describe('SidebarNav identity card', () => {
  it('opens the profile when pressed', async () => {
    const onUserClick = vi.fn()
    render(<SidebarNav user={user} onUserClick={onUserClick} />)

    await userEvent.click(card())

    expect(onUserClick).toHaveBeenCalledOnce()
  })

  it('is reachable by keyboard alone, which a div with onClick is not', async () => {
    const onUserClick = vi.fn()
    render(<SidebarNav user={user} onUserClick={onUserClick} />)

    await userEvent.tab()
    expect(card()).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(onUserClick).toHaveBeenCalledOnce()
  })

  it('marks itself current on the profile page, where no sidebar item matches', () => {
    render(<SidebarNav user={user} onUserClick={vi.fn()} active="profile" />)

    expect(card()).toHaveAttribute('aria-current', 'page')
  })

  it('is not current on any other page', () => {
    render(<SidebarNav user={user} onUserClick={vi.fn()} active="dashboard" />)

    expect(card()).not.toHaveAttribute('aria-current')
  })

  /**
   * Without a handler there is nowhere to go, and a pressable-looking widget
   * that does nothing is worse than the plain identity it replaces.
   */
  it('stays an inert card when no handler is given', () => {
    render(<SidebarNav user={user} />)

    expect(screen.queryByRole('button', { name: /ada nakato/i })).toBeNull()
    expect(screen.getByText('Ada Nakato')).toBeVisible()
  })
})
