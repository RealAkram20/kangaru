import type { HTMLAttributes } from 'react'

export interface FormFieldProps extends HTMLAttributes<HTMLDivElement> {
  /** Inter Medium 14px. Sentence case, no colon. */
  label?: string
  htmlFor?: string
  /** Helper text below the control; replaced by `error` when present. */
  hint?: string
  error?: string
  required?: boolean
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  style,
  ...rest
}: FormFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }} {...rest}>
      {label && (
        <label htmlFor={htmlFor} style={{ font: 'var(--type-label)', color: 'var(--text-body)' }}>
          {label}
          {required && <span style={{ color: 'var(--kr-error)', marginLeft: 3 }}>*</span>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <p style={{ font: 'var(--type-caption)', color: error ? 'var(--kr-error)' : 'var(--text-secondary)' }}>
          {error || hint}
        </p>
      )}
    </div>
  )
}
