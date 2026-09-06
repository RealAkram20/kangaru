import { Children, cloneElement, isValidElement, useId, type CSSProperties, type HTMLAttributes, type ReactElement } from 'react'
import './formField.css'

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
  /**
   * Keeps the label in the accessibility tree while removing it from the
   * page.
   *
   * For a form laid out as a grid — a rate card's rows of Base fare, Per km,
   * Minimum — the column headings are shown once and every row below reads
   * from position. Dropping the label from those rows leaves their controls
   * with no accessible name at all, which is what a screen reader has
   * instead of the alignment a sighted user reads. Clipping keeps the name
   * and drops only the repetition.
   */
  labelHidden?: boolean
  htmlFor?: string
  /** Helper text below the control; replaced by `error` when present. */
  hint?: string
  error?: string
  required?: boolean
  /**
   * `stack` (the default) puts the label above the control — the shape every
   * existing form in the console uses.
   *
   * `split` puts label and hint in a left column and the control and its error
   * in a right one, so a long list of settings reads as rows rather than as a
   * tall stack, and every control on the page starts on the same vertical
   * line. Collapses back to a stack below `COMPACT_MAX_WIDTH`, in
   * `formField.css`.
   */
  layout?: 'stack' | 'split'
}

/**
 * ARIA the control needs but cannot know: whether its field is required,
 * whether it is currently in error, and which paragraph explains it.
 *
 * Applied by cloning rather than asked of every caller, because the
 * alternative is `required` written twice at each call site — on the
 * FormField for the asterisk and again on the Input for the ARIA — which
 * is exactly the pair that drifts. The label already says "(required)" to
 * a screen reader; without `aria-required` on the input itself, a user
 * tabbing straight into the control never hears it, and a form navigated
 * field-by-field is how screen readers are actually used.
 *
 * Props already set explicitly on the child win. A caller who has a reason
 * to say `aria-describedby` themselves is not overruled by this.
 */
function describeControl(
  children: FormFieldProps['children'],
  { required, invalid, messageId }: { required: boolean; invalid: boolean; messageId?: string },
) {
  const only = Children.only(children)

  if (!isValidElement(only)) return children

  const existing = only.props as Record<string, unknown>

  return cloneElement(only as ReactElement<Record<string, unknown>>, {
    'aria-required': existing['aria-required'] ?? (required || undefined),
    'aria-invalid': existing['aria-invalid'] ?? (invalid || undefined),
    'aria-describedby': existing['aria-describedby'] ?? messageId,
  })
}

export function FormField({
  label,
  labelHidden = false,
  htmlFor,
  hint,
  error,
  required = false,
  layout = 'stack',
  children,
  style,
  className,
  ...rest
}: FormFieldProps) {
  // Stable across renders and unique per field, so two fields on the same
  // form cannot point at each other's message.
  const generatedId = useId()
  const messageId = error || hint ? `${htmlFor ?? generatedId}-message` : undefined

  // A single element is the shape every call site uses. Anything else —
  // a fragment, two controls, a bare string — is left exactly as it was
  // rather than guessed at, since there would be no way to know which of
  // them the label describes.
  let control = children

  try {
    control = describeControl(children, { required, invalid: Boolean(error), messageId })
  } catch {
    // Children.only throws for zero or several children. Not an error
    // worth surfacing: the field still renders, it just does not annotate.
  }

  const labelNode = label ? (
    <label
      htmlFor={htmlFor}
      style={
        labelHidden ? SR_ONLY : { font: 'var(--type-label)', color: 'var(--text-body)' }
      }
    >
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
  ) : null

  // One paragraph, error winning over hint, in both layouts: two live
  // messages would need two ids on `aria-describedby` and would read the
  // field's explanation out again at the moment the reader wants the fix.
  const messageNode =
    error || hint ? (
      <p
        id={messageId}
        style={{
          font: 'var(--type-caption)',
          color: error ? 'var(--kr-error)' : 'var(--text-secondary)',
        }}
      >
        {error || hint}
      </p>
    ) : null

  if (layout === 'split') {
    return (
      <div className={['kr-field-split', className].filter(Boolean).join(' ')} style={style} {...rest}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {labelNode}
          {/* The hint sits under the label rather than under the control:
              it explains what the setting is, which is the question being
              asked on the left. The error goes on the right, next to the
              value that caused it. */}
          {!error && messageNode}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          {control}
          {error && messageNode}
        </div>
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}
      {...rest}
    >
      {labelNode}
      {control}
      {messageNode}
    </div>
  )
}
