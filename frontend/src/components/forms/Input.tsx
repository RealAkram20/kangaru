import { useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../core/Icon'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg'
  /** Lucide icon inside the field, left of the text. */
  iconLeft?: string
  iconRight?: string
  /** Render the value in JetBrains Mono — odometer readings, plates, reference codes. */
  mono?: boolean
  invalid?: boolean
  /** Static trailing unit, e.g. "km" or "UGX". */
  suffix?: ReactNode
  /**
   * Adds a show/hide toggle to a password field. Only meaningful with
   * `type="password"`; ignored otherwise.
   *
   * Typing a long credential blind is how people end up locked out, and the
   * login endpoint is throttled to 5 attempts a minute — so a mistyped
   * password costs a minute, not a retry.
   */
  revealable?: boolean
}

export function Input({
  value,
  defaultValue,
  onChange,
  placeholder,
  type = 'text',
  size = 'md',
  iconLeft,
  iconRight,
  mono = false,
  invalid = false,
  disabled = false,
  readOnly = false,
  suffix,
  revealable = false,
  id,
  style,
  ...rest
}: InputProps) {
  const [focus, setFocus] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const h = size === 'sm' ? 'var(--control-h-sm)' : size === 'lg' ? 'var(--control-h-lg)' : 'var(--control-h-md)'

  const canReveal = revealable && type === 'password' && !disabled
  // Revealing swaps the rendered type; `type` itself stays the caller's
  // declared intent so password managers still treat the field correctly.
  const renderedType = canReveal && revealed ? 'text' : type
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: h,
        padding: '0 12px',
        background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
        border:
          '1px solid ' + (invalid ? 'var(--kr-error)' : focus ? 'var(--action-primary)' : 'var(--border-input)'),
        borderRadius: 'var(--radius-input)',
        boxShadow: focus ? '0 0 0 3px rgba(1,144,61,.16)' : 'none',
        transition: 'var(--transition-control)',
        opacity: disabled ? 0.7 : 1,
        ...style,
      }}
    >
      {iconLeft && <Icon name={iconLeft} size={16} style={{ color: 'var(--text-placeholder)' }} />}
      <input
        id={id}
        type={renderedType}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={
          {
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: mono ? 'var(--type-identifier)' : size === 'lg' ? 'var(--type-body)' : 'var(--type-body-dense)',
            color: 'var(--text-body)',
            fontVariantNumeric: type === 'number' || mono ? 'tabular-nums' : 'normal',
          } as CSSProperties
        }
        {...rest}
      />
      {suffix && <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{suffix}</span>}
      {canReveal && (
        <button
          // Inside a form, so the type matters: a bare <button> defaults to
          // submit and revealing the password would post the form.
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          // Not in the tab order: keyboard users tabbing from the password
          // field expect the submit button next, and a toggle that only
          // changes what is on screen is not worth a stop. Still reachable
          // by pointer, and by screen readers, which navigate by control.
          tabIndex={-1}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: 4,
            margin: -4,
            border: 'none',
            background: 'transparent',
            color: revealed ? 'var(--text-secondary)' : 'var(--text-placeholder)',
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm, 4px)',
          }}
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} size={16} />
        </button>
      )}
      {iconRight && <Icon name={iconRight} size={16} style={{ color: 'var(--text-placeholder)' }} />}
    </div>
  )
}
