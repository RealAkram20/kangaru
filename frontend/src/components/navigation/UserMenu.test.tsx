import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UserMenu } from './UserMenu'

/**
 * The avatar used to be a `<span>` that looked like a control and was not
 * one. These assert the parts that make it a real menu rather than a
 * `div` with a click handler — which is the usual way this regresses
 * AGENTS.md's "keyboard navigation, visible focus states".
 */
function renderMenu() {
  const onSettings = vi.fn()
  const onSignOut = vi.fn()

  render(
    <UserMenu
      name="Ada Nakato"
      role="Corporate Admin"
      email="ada@centenary-bank.test"
      onSettings={onSettings}
      onSignOut={onSignOut}
    />,
  )

  return { onSettings, onSignOut }
}

const trigger = () => screen.getByRole('button', { name: /account menu for ada nakato/i })

describe('UserMenu', () => {
  it('starts closed, and says so to a screen reader', () => {
    renderMenu()

    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens on click and offers Settings and Sign out', async () => {
    renderMenu()

    await userEvent.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    // Who you are signed in as — the question the menu exists to answer.
    expect(screen.getByText('ada@centenary-bank.test')).toBeVisible()
  })

  it('reaches Settings, which had no navigation entry at all before this', async () => {
    const { onSettings } = renderMenu()

    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))

    expect(onSettings).toHaveBeenCalledOnce()
    // Closed behind itself: a menu left hanging over the page it just
    // navigated to is the classic version of this bug.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('signs out', async () => {
    const { onSignOut } = renderMenu()

    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(onSignOut).toHaveBeenCalledOnce()
  })

  /**
   * Escape must both close it and put focus back on the trigger. Dropping
   * focus on `<body>` strands a keyboard user at the top of the document —
   * the menu sits at the end of the chrome, so they would re-tab the page.
   */
  it('closes on Escape and returns focus to the trigger', async () => {
    renderMenu()

    await userEvent.click(trigger())
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it('closes when something else is clicked', async () => {
    renderMenu()

    await userEvent.click(trigger())
    await userEvent.click(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens by keyboard alone', async () => {
    renderMenu()

    await userEvent.tab()
    expect(trigger()).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeVisible()
  })
})
