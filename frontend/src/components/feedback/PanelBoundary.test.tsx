import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelBoundary } from './PanelBoundary'

/**
 * A React render error unmounts the whole tree above it, so one report
 * panel dereferencing something the API did not send blanks the entire
 * page — no message, no navigation, nothing to click. On a screen a bank
 * is being shown, that reads as "the product is broken" rather than "this
 * figure is unavailable".
 *
 * These render deliberately-throwing children, which React reports through
 * `console.error` whether or not a boundary handles them. Silenced per
 * test rather than globally, so a genuine unexpected error elsewhere still
 * shows up in the run.
 */
function Explodes({ when = true }: { when?: boolean }): React.ReactElement {
  if (when) throw new Error('the API sent null where a number was expected')

  return <p>panel content</p>
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('PanelBoundary', () => {
  it('renders its children when nothing is wrong', () => {
    render(
      <PanelBoundary label="the financial report">
        <Explodes when={false} />
      </PanelBoundary>,
    )

    expect(screen.getByText('panel content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('replaces only the failed panel, leaving its siblings standing', () => {
    render(
      <div>
        <p>the filters</p>
        <PanelBoundary label="the financial report">
          <Explodes />
        </PanelBoundary>
        <p>the export panel</p>
      </div>,
    )

    // The whole point. Without the boundary this render throws and the
    // enclosing tree — filters, export panel, navigation — unmounts with
    // it, leaving a blank page.
    expect(screen.getByText('the filters')).toBeInTheDocument()
    expect(screen.getByText('the export panel')).toBeInTheDocument()

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Could not display the financial report/,
    )
  })

  it('names the panel, and says the rest of the page still works', () => {
    render(
      <PanelBoundary label="the driver report">
        <Explodes />
      </PanelBoundary>,
    )

    const alert = screen.getByRole('alert')

    // AGENTS.md Error Handling: what happened and what to do next.
    expect(alert).toHaveTextContent(/Could not display the driver report/)
    expect(alert).toHaveTextContent(/rest of the page is unaffected/)
  })

  it('never shows the exception text', () => {
    render(
      <PanelBoundary label="the trip summary">
        <Explodes />
      </PanelBoundary>,
    )

    // "Cannot read properties of undefined" tells a transport manager
    // nothing and tells an attacker something. AGENTS.md: never expose raw
    // exceptions to users.
    expect(screen.queryByText(/the API sent null/)).not.toBeInTheDocument()
  })

  it('logs the error rather than swallowing it', () => {
    render(
      <PanelBoundary label="the trip summary">
        <Explodes />
      </PanelBoundary>,
    )

    // A boundary that hid the stack would turn a loud bug into a quiet
    // one. Tagged with the panel so "the financial panel broke" is
    // greppable.
    expect(consoleError).toHaveBeenCalledWith(
      '[panel:the trip summary]',
      expect.objectContaining({ message: 'the API sent null where a number was expected' }),
      expect.anything(),
    )
  })

  it('offers a retry that re-renders the panel', async () => {
    // A render error is often transient state rather than a permanent
    // fault, so the fallback offers a way back rather than only an apology.
    //
    // A flag rather than a call counter: React re-invokes a throwing
    // component to capture its stack, so "throw on the first call only"
    // recovers by itself on the second and tests nothing.
    let broken = true

    function Flaky() {
      return <Explodes when={broken} />
    }

    render(
      <PanelBoundary label="the trip summary">
        <Flaky />
      </PanelBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    broken = false

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByText('panel content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
