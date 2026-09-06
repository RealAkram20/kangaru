import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../core/Icon'

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type'
> {
  /** Sits to the right of the box and is part of the label, so it is clickable. */
  label?: ReactNode
  /** Second line under the label — what the permission actually allows. */
  hint?: ReactNode
  /**
   * Neither ticked nor clear — "some of the rows below", on a select-all.
   *
   * A prop rather than a ref the caller sets, because `indeterminate` exists
   * only as a DOM property: there is no attribute for it, so it cannot be
   * expressed in JSX at all and every caller would otherwise need its own
   * ref and effect. The docblock below keeps the native input precisely so
   * this state is real to a screen reader rather than drawn.
   */
  indeterminate?: boolean
}

/**
 * A checkbox, on a real `<input type="checkbox">`.
 *
 * The native control is kept and visually hidden rather than replaced by a
 * `role="checkbox"` div: that is what gives keyboard toggling, form
 * participation, the indeterminate state and screen-reader semantics
 * without re-earning any of them. The square beside it is decoration
 * (`aria-hidden`) driven by the input's own state.
 *
 * Built for the role editor, which renders the whole permission catalogue —
 * around thirty of these at once — so `hint` carries the permission's
 * description inline instead of every row needing a `FormField` wrapper.
 */
export function Checkbox({
  label,
  hint,
  checked,
  disabled = false,
  indeterminate = false,
  id,
  style,
  ...rest
}: CheckboxProps) {
  const [focus, setFocus] = useState(false)
  const box = useRef<HTMLInputElement>(null)

  // The one property with no attribute. Written after every render, because a
  // select-all flips between all three states as rows are ticked.
  useEffect(() => {
    if (box.current) box.current.indeterminate = indeterminate
  }, [indeterminate, checked])

  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: '7px var(--space-2)',
        borderRadius: 'var(--radius-control)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'var(--transition-control)',
        ...style,
      }}
    >
      <input
        ref={box}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        // Clipped rather than `display:none` or `visibility:hidden`, both of
        // which take the control out of the accessibility tree and the tab
        // order along with it.
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
          width: 18,
          height: 18,
          flex: '0 0 auto',
          marginTop: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-sm)',
          background: checked ? 'var(--action-primary)' : 'var(--surface-card)',
          border: '1px solid ' + (checked ? 'var(--action-primary)' : 'var(--border-input)'),
          color: 'var(--text-on-brand)',
          // The focus ring belongs on the square, because the real input is
          // clipped to a pixel and its own ring would be invisible.
          boxShadow: focus ? '0 0 0 3px rgba(1,144,61,.16)' : 'none',
          transition: 'var(--transition-control)',
        }}
      >
        {checked && <Icon name="check" size={13} />}
      </span>
      {(label || hint) && (
        <span style={{ minWidth: 0, lineHeight: 1.35 }}>
          {label && (
            <span
              style={{
                display: 'block',
                font: 'var(--type-body-dense)',
                color: 'var(--text-body)',
              }}
            >
              {label}
            </span>
          )}
          {hint && (
            <span
              style={{
                display: 'block',
                font: 'var(--type-caption)',
                color: 'var(--text-secondary)',
              }}
            >
              {hint}
            </span>
          )}
        </span>
      )}
    </label>
  )
}
