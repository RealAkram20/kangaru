import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActingAsBanner } from './ActingAsBanner'

const session = { subject_name: 'Joan Okello', expires_at: '2026-08-22T05:12:00Z' }

describe('ActingAsBanner', () => {
  it('names the person whose account is being held', () => {
    render(<ActingAsBanner session={session} onStop={() => {}} />)

    // The whole point of the banner: a support agent's browser otherwise
    // renders as that person with nothing to say it is not really them.
    expect(screen.getByText(/acting as Joan Okello/i)).toBeInTheDocument()
  })

  it('says that what is done here is recorded against both names', () => {
    render(<ActingAsBanner session={session} onStop={() => {}} />)

    // ADR-0056 §2 is only kept if the person holding the account knows it is
    // being kept. A trail nobody is told about does not deter anything.
    expect(screen.getByText(/recorded against your name as well as theirs/i)).toBeInTheDocument()
  })

  it('offers no way to dismiss it, only a way to stop', () => {
    render(<ActingAsBanner session={session} onStop={() => {}} />)

    // A time-boxed privilege you can hide is a privilege with no indicator.
    expect(screen.queryByRole('button', { name: /dismiss|close/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('stops when asked', async () => {
    const onStop = vi.fn()
    render(<ActingAsBanner session={session} onStop={onStop} />)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(onStop).toHaveBeenCalledOnce()
  })

  it('cannot be pressed twice while it is stopping', async () => {
    const onStop = vi.fn()
    render(<ActingAsBanner session={session} onStop={onStop} stopping />)

    await userEvent.click(screen.getByRole('button', { name: /stopping/i }))

    // Two stop requests would be harmless — `end()` is idempotent — but a
    // button that keeps accepting presses while it works reads as one that
    // did not hear the first.
    expect(onStop).not.toHaveBeenCalled()
  })

  it('announces politely rather than interrupting', () => {
    render(<ActingAsBanner session={session} onStop={() => {}} />)

    // `status`, not `alert`. It is a standing condition for the whole session,
    // and an assertive live region would talk over whatever a screen-reader
    // user was reading, every time they navigated.
    expect(screen.getByTestId('acting-as-banner')).toHaveAttribute('role', 'status')
  })
})
