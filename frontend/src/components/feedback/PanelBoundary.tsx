import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert } from './Alert'
import { Button } from '../core/Button'

interface Props {
  /** Names the panel in the fallback, e.g. "the financial report". */
  label: string
  children: ReactNode
}

interface State {
  failed: boolean
}

/**
 * Keeps one panel's failure from taking the whole screen with it.
 *
 * A React render error unmounts the entire tree above it, so a single
 * report panel dereferencing something the API did not send blanks the
 * page — no message, no navigation, nothing to click. On a screen a bank
 * is shown that is the worst possible failure: it reads as "the product is
 * broken" rather than "this figure is unavailable".
 *
 * ## What this does and does not catch
 *
 * **Render errors only.** React error boundaries do not see rejected
 * promises, so a failed `GET` is still the page's own job — those already
 * land in an `Alert` via each panel's catch. What lands here is the class
 * of bug no `try` covers: a `.map` on something that arrived as null, a
 * field the resource stopped sending, a number formatter handed a string.
 *
 * **It is not a substitute for handling the error.** `componentDidCatch`
 * logs, deliberately: a boundary that swallowed the stack would turn a
 * loud bug into a quiet one, and the console is where the next developer
 * looks. It also offers a retry rather than only an apology, because a
 * render error is often transient state rather than a permanent one.
 *
 * A class because that is the only form React gives this. There is no hook
 * equivalent, and adding `react-error-boundary` for one component is a
 * dependency this repo does not need.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept, not swallowed. Structured the way AGENTS.md asks server logs to
    // be — the panel is the `module` equivalent, so a report of "the
    // financial panel broke" is greppable.
    console.error(`[panel:${this.props.label}]`, error, info.componentStack)
  }

  private retry = (): void => {
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <Alert
        tone="error"
        title={`Could not display ${this.props.label}`}
        // AGENTS.md Error Handling: what happened, and what to do next.
        // Deliberately does not show the exception — "Cannot read
        // properties of undefined" tells a transport manager nothing and
        // tells an attacker something.
        action={
          <Button size="sm" variant="secondary" iconLeft="refresh-cw" onClick={this.retry}>
            Try again
          </Button>
        }
      >
        Something went wrong rendering this section. The rest of the page is unaffected, and your
        other reports still work. Try again, and contact support if it keeps happening.
      </Alert>
    )
  }
}
