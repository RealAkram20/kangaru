import { useState, type CSSProperties, type SelectHTMLAttributes } from 'react'
import { Icon } from '../core/Icon'

/**
 * Ported from `KangaruRide Design System/components/forms/Select.jsx`.
 * A native `<select>` under a styled shell — keyboard behaviour, mobile
 * pickers and screen-reader support come free, which a custom listbox would
 * have to re-earn.
 */
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg'
  options?: (SelectOption | string)[]
  placeholder?: string
  invalid?: boolean
}

export function Select({
  value,
  defaultValue,
  onChange,
  options = [],
  placeholder,
  size = 'md',
  invalid = false,
  disabled = false,
  id,
  style,
  ...rest
}: SelectProps) {
  const [focus, setFocus] = useState(false)
  const h = size === 'sm' ? 'var(--control-h-sm)' : size === 'lg' ? 'var(--control-h-lg)' : 'var(--control-h-md)'

  const field: CSSProperties = {
    appearance: 'none',
    WebkitAppearance: 'none',
    flex: 1,
    height: '100%',
    padding: '0 34px 0 12px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    font: size === 'lg' ? 'var(--type-body)' : 'var(--type-body-dense)',
    color: value || defaultValue ? 'var(--text-body)' : 'var(--text-placeholder)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        height: h,
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
      <select
        id={id}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={field}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => {
          const o = typeof option === 'string' ? { value: option, label: option } : option
          return (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          )
        })}
      </select>
      <Icon
        name="chevron-down"
        size={16}
        style={{ position: 'absolute', right: 10, color: 'var(--text-secondary)', pointerEvents: 'none' }}
      />
    </div>
  )
}
