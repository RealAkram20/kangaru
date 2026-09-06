import { useState, type InputHTMLAttributes } from 'react'

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type' | 'role'
> {
  /**
   * Only for a switch that stands alone. Inside a settings row the name comes
   * from the row's own `<label htmlFor>`, and passing it twice would have a
   * screen reader read it twice.
   */
  label?: string
}

/**
 * An on/off control, on a real `<input type="checkbox">` with `role="switch"`.
 *
 * Same construction as `Checkbox` and for the same reason: the native input is
 * kept and clipped rather than replaced by a `role="switch"` div, so keyboard
 * toggling, form participation and the checked state are inherited instead of
 * re-earned. The track and thumb beside it are decoration (`aria-hidden`)
 * driven by the input's own state.
 *
 * **Why a switch and not the checkbox we already have.** Settings read as a
 * list of things that are on or off, and a right-hand column of checkboxes
 * reads as a form to fill in rather than a state to inspect. The usual
 * objection — a switch implies the change lands immediately, and here it lands
 * on Save — is answered by the page rather than by the control: an edited
 * section says "Unsaved changes" in its action bar and carries a marker in the
 * section rail until it is saved.
 *
 * **The off track is `--text-secondary`, not a pale grey.** WCAG 2.2 asks 3:1
 * of a control against its surface; `--border-strong` measures 1.9:1 on white,
 * so the pale version that looks right in a mockup is the one a bright screen
 * loses. Position, not colour, is what says on or off — the role announces it
 * too, so nothing here is carried by colour alone.
 */
export function Switch({ label, checked = false, disabled = false, id, style, ...rest }: SwitchProps) {
  const [focus, setFocus] = useState(false)

  return (
    <label
      htmlFor={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        // Padding rather than a taller track: it grows the hit area to 48x32
        // without the switch itself becoming a slab.
        padding: 'var(--space-1) var(--space-1)',
        margin: 'calc(var(--space-1) * -1)',
        borderRadius: 'var(--radius-control)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        width: 'fit-content',
        ...style,
      }}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
        {...rest}
      />
      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 24,
          flex: '0 0 auto',
          padding: 3,
          display: 'inline-flex',
          alignItems: 'center',
          borderRadius: 'var(--radius-pill)',
          background: checked ? 'var(--action-primary)' : 'var(--text-secondary)',
          boxShadow: focus ? '0 0 0 3px rgba(1,144,61,.22)' : 'none',
          transition: 'background-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)',
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--kr-paper)',
            boxShadow: 'var(--shadow-xs)',
            // transform only: the thumb slides on the compositor rather than
            // relaying out the track on every toggle.
            transform: checked ? 'translateX(16px)' : 'translateX(0)',
            transition: 'transform var(--dur-fast) var(--ease-out)',
          }}
        />
      </span>
      {label && (
        <span style={{ font: 'var(--type-body-dense)', color: 'var(--text-body)' }}>{label}</span>
      )}
    </label>
  )
}
