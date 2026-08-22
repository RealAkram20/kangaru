import type { PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../core/Icon'

export interface ActingAsSession {
  /** The person whose account is being held. */
  subject_name: string
  /** ISO-8601. When the session lapses on its own (ADR-0056 §5). */
  expires_at: string
}

interface Props {
  session: ActingAsSession
  onStop: () => void
  stopping?: boolean
}

/**
 * Says, permanently and unmissably, that this console is not yours right now
 * (ADR-0056 §5).
 *
 * ## Why this is not `<Alert tone="warning">`
 *
 * `Alert` is an in-page message: rounded, bordered on four sides, optionally
 * dismissible, sitting *inside* content. This is application chrome that
 * cannot be dismissed and must not be mistaken for a notice that arrived and
 * will leave. Giving permanent chrome the visual language of a dismissible
 * alert is exactly the "it looks like a toast, I will stop seeing it" failure
 * this component exists to prevent — so it borrows `Alert`'s **tokens and
 * `Icon`** and none of its shape.
 *
 * ## It does not animate, and that is a decision
 *
 * A support session begins on another screen; by the time this renders the
 * navigation has already happened, so there is no in-page transition to
 * smooth. Animating it in would make it read as *something that arrived*,
 * which is the wrong reading. `docs/screen-rules.md` §5: every animation needs
 * a reason, and "it looks nice" is not one.
 *
 * The one exception is the Stop button's press, which earns its 160 ms: that
 * is the control somebody reaches for when they want out, and a press that
 * gives no feedback feels like it was not heard.
 *
 * ## Amber, and `user-cog`
 *
 * Red says something broke. This is an unusual **state**, deliberately
 * entered, and the person needs to notice it rather than fear it.
 *
 * The glyph says *what is happening* — a user's account being operated by
 * staff — rather than *how to feel*, which the colour already carries. It is
 * also already in `iconRegistry`; `shield-alert` is not, and a name missing
 * from that registry renders a **silent grey box** rather than throwing. Never
 * colour alone (§6): the icon and the sentence carry the meaning too.
 */
export function ActingAsBanner({ session, onStop, stopping = false }: Props) {
  const press = (scale: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.style.transform = scale
  }

  return (
    <div
      // `status`, not `alert`: announced politely once when it appears rather
      // than interrupting whatever a screen-reader user was reading. A
      // standing condition, not an emergency.
      role="status"
      data-testid="acting-as-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-4)',
        background: 'var(--kr-warning-tint)',
        // Bottom edge only. A full border would box it and read as content;
        // this reads as a seam in the chrome.
        borderBottom: '1px solid var(--kr-warning)',
        color: 'var(--kr-warning)',
      }}
    >
      <Icon name="user-cog" size={18} aria-hidden />

      <p style={{ font: 'var(--type-body-dense)', flex: 1, minWidth: 0 }}>
        <strong style={{ fontWeight: 'var(--weight-semibold)' }}>
          You are acting as {session.subject_name}.
        </strong>{' '}
        Everything you do is recorded against your name as well as theirs.
      </p>

      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        style={{
          font: 'var(--type-label)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--kr-warning-tint)',
          background: 'var(--kr-warning)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-1) var(--space-3)',
          cursor: stopping ? 'progress' : 'pointer',
          transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)',
        }}
        onPointerDown={press('scale(0.97)')}
        onPointerUp={press('scale(1)')}
        onPointerLeave={press('scale(1)')}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  )
}
