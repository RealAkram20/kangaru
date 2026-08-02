import type { CSSProperties, HTMLAttributes } from 'react'

/**
 * Clipped, not hidden: `display:none` and `visibility:hidden` both remove
 * the text from the accessibility tree, which is the one place it needs to
 * exist.
 */
const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

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
          {required && (
            <>
              {/* The asterisk is a sighted convention and nothing else. Left
                  in the accessible name it was read out literally — a
                  screen reader announced the passenger field as "Passenger
                  star" — so it is hidden and the meaning it stands for is
                  supplied as words instead. Dropping it without the
                  replacement would have been the other failure: a required
                  field that never says it is required. */}
              <span aria-hidden="true" style={{ color: 'var(--kr-error)', marginLeft: 3 }}>
                *
              </span>
              {/* The separating space is a text node in the label rather
                  than the first character of the clipped span: inside it,
                  accessible-name computation collapses it away and the
                  field announces as "Passenger(required)". */}{' '}
              <span style={SR_ONLY}>(required)</span>
            </>
          )}
        </label>
      )}
      {children}
      {(error || hint) && (
        <p
          style={{
            font: 'var(--type-caption)',
            color: error ? 'var(--kr-error)' : 'var(--text-secondary)',
          }}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}
