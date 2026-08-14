import { useState, type CSSProperties, type TextareaHTMLAttributes } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  /**
   * Visible lines before it scrolls. The default suits a paragraph; the legal
   * notices ask for far more, because scrolling a long document inside a short
   * box is how typos survive proofreading.
   */
  rows?: number
}

/**
 * The multi-line counterpart to `Input`, sharing its border, focus ring and
 * control tokens so the two never look like they came from different kits.
 *
 * Resizing is left vertical-only: a horizontally resizable field can be
 * dragged wider than the card it sits in, which on this page would push the
 * save button off screen.
 */
export function Textarea({
  value,
  defaultValue,
  onChange,
  placeholder,
  invalid = false,
  disabled = false,
  readOnly = false,
  rows = 6,
  id,
  style,
  ...rest
}: TextareaProps) {
  const [focus, setFocus] = useState(false)

  return (
    <div
      style={{
        padding: '10px 12px',
        background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
        border:
          '1px solid ' +
          (invalid ? 'var(--kr-error)' : focus ? 'var(--action-primary)' : 'var(--border-input)'),
        borderRadius: 'var(--radius-input)',
        boxShadow: focus ? '0 0 0 3px rgba(1,144,61,.16)' : 'none',
        transition: 'var(--transition-control)',
        opacity: disabled ? 0.7 : 1,
        ...style,
      }}
    >
      <textarea
        id={id}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        rows={rows}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={
          {
            display: 'block',
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            resize: 'vertical',
            font: 'var(--type-body-dense)',
            lineHeight: 1.6,
            color: 'var(--text-body)',
          } as CSSProperties
        }
        {...rest}
      />
    </div>
  )
}