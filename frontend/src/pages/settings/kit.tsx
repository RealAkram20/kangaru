import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Alert } from '../../components/feedback/Alert'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { PageContext, type Primitive, type SectionMeta, type SectionState } from './state'
import type { SecretValue, Settings } from './types'
import './settings.css'

/* -------------------------------------------------------------- the shell */

interface SectionFormProps<T extends Record<string, Primitive>> {
  section: SectionMeta
  state: SectionState<T>
  onSaved: (settings: Settings) => void
  /** What `PATCH /settings/{group}` receives. The whole group, every time. */
  payload: () => Record<string, unknown>
  /** Header-right slot, for an action that must stay reachable when clean. */
  actions?: ReactNode
  /** Credential boxes to empty once the server has them. */
  secretKeys?: (keyof T)[]
  children: (errors: Record<string, string>) => ReactNode
}

/**
 * A settings section: header, rows, and the bar that saves them.
 *
 * **The save is optimistic.** Pressing Save acknowledges immediately — the
 * button reads "Saved" and the unsaved marker clears — rather than sitting in
 * a "Saving…" state for the round trip. This costs nothing in honesty because
 * the form's source of truth is its own state: the server's answer is never
 * needed to keep showing what the operator typed, so a rejection puts the
 * section back exactly as it was, marks it unsaved again, and says why. There
 * is no half-written state to reconcile and nothing to lose.
 *
 * The acknowledgement is the button's own label and nothing more. A toast for
 * "the thing you asked for happened" outweighs the action, on a page an
 * operator saves several times in a sitting.
 */
export function SectionForm<T extends Record<string, Primitive>>({
  section,
  state,
  onSaved,
  payload,
  actions,
  secretKeys,
  children,
}: SectionFormProps<T>) {
  const [status, setStatus] = useState<'idle' | 'saved'>('idle')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inFlight = useRef(false)
  const { reportDirty } = useContext(PageContext)

  useEffect(() => () => clearTimeout(timer.current), [])

  // Reported rather than lifted: the rail needs to know, and the state itself
  // has no business leaving the section that owns it.
  useEffect(() => {
    reportDirty(section.id, state.dirty && status !== 'saved')
  }, [reportDirty, section.id, state.dirty, status])

  const save = async () => {
    // A second press while the first is in the air would send the same group
    // twice and race two answers into `onSaved`. The button still reads
    // "Saved" rather than going disabled — disabling the control a user just
    // pressed is the interface arguing with them.
    if (inFlight.current) return
    inFlight.current = true

    setMessage(null)
    setErrors({})
    setStatus('saved')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 1600)

    try {
      const response = await apiClient.patch(`/settings/${section.group}`, payload())
      onSaved(response.data.data.settings as Settings)
      if (secretKeys?.length) state.clear(secretKeys)
    } catch (failure) {
      const problem = apiError(failure, 'Could not save settings.')
      const byField = fieldErrors(problem)
      // The rollback: nothing was overwritten, so putting the section back is
      // only a matter of withdrawing the acknowledgement. `state.dirty` is
      // still true on its own — props never moved — so the bar returns.
      clearTimeout(timer.current)
      setStatus('idle')
      setErrors(byField)
      setMessage(Object.keys(byField).length === 0 ? problem.message : null)
    } finally {
      inFlight.current = false
    }
  }

  const unsaved = state.dirty && status === 'idle'

  return (
    <Card
      title={section.title}
      subtitle={section.description}
      actions={actions}
      bodyStyle={{ padding: 0 }}
      // Card clips its children so a flush table cannot escape the radius.
      // The save bar has to, because `position: sticky` resolves against the
      // nearest clipping ancestor: inside `overflow: hidden` it would be
      // pinned to a box that never scrolls, and simply never stick.
      style={{ overflow: 'visible' }}
      footer={
        <div className="kr-settings-bar">
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              font: 'var(--type-caption)',
              color: 'var(--text-secondary)',
            }}
          >
            {unsaved && (
              <>
                {/* A bullet, not an icon: it marks a line of text rather than
                    standing for anything, and the words beside it carry the
                    meaning so nothing here is said in colour alone. */}
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--kr-warning)',
                  }}
                />
                Unsaved changes
              </>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {unsaved && (
              <Button type="button" variant="ghost" onClick={state.reset}>
                Discard
              </Button>
            )}
            <Button
              type="submit"
              form={`settings-${section.id}`}
              iconLeft={status === 'saved' ? 'check' : undefined}
            >
              {status === 'saved' ? 'Saved' : 'Save changes'}
            </Button>
          </span>
        </div>
      }
    >
      <form
        id={`settings-${section.id}`}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        className="kr-settings-body"
      >
        {message !== null && (
          <div className="kr-setting-note">
            <Alert tone="error" title={section.title} onDismiss={() => setMessage(null)}>
              {message}
            </Alert>
          </div>
        )}
        {children(errors)}
      </form>
    </Card>
  )
}

/* --------------------------------------------------------------- the rows */

/**
 * One setting: what it is on the left, what it is set to on the right.
 *
 * `control` is a max width rather than a fixed one, so a field is as wide as
 * its content deserves — a currency code does not need the room a hostname
 * does — while every control still starts on the same vertical line.
 */
export function Row({
  label,
  htmlFor,
  hint,
  error,
  required,
  control,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  required?: boolean
  /** Max width of the control in pixels. Omit to fill the column. */
  control?: number
  children: ReactNode
}) {
  return (
    <FormField
      className="kr-setting-row"
      layout="split"
      label={label}
      htmlFor={htmlFor}
      hint={hint}
      error={error}
      required={required}
    >
      <div style={{ maxWidth: control ?? '100%', minWidth: 0 }}>{children}</div>
    </FormField>
  )
}

/** A full-width row — a textarea, where a label column would waste the space. */
export function StackedRow({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <FormField
      className="kr-setting-row"
      label={label}
      htmlFor={htmlFor}
      hint={hint}
      error={error}
    >
      {children}
    </FormField>
  )
}

/** A band that names the next few rows: "Weekly bonus", "Peak hours". */
export function Group({ children }: { children: ReactNode }) {
  return <div className="kr-setting-group">{children}</div>
}

/** An Alert or aside that spans the whole pane rather than sitting in a column. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="kr-setting-note">{children}</div>
}

/**
 * A write-only credential (ADR-0014 §3): shows whether one is stored, and
 * takes a replacement. Empty means "leave it" and is omitted from the save.
 */
export function SecretRow({
  label,
  htmlFor,
  secret,
  value,
  onChange,
  error,
}: {
  label: string
  htmlFor: string
  secret: SecretValue
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <Row
      label={label}
      htmlFor={htmlFor}
      hint={secret.configured ? 'Configured. Type to replace it.' : 'Not configured.'}
      error={error}
      control={380}
    >
      <Input
        id={htmlFor}
        type="password"
        iconLeft="key-round"
        autoComplete="new-password"
        placeholder={secret.configured ? '••••••••' : ''}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        revealable
      />
    </Row>
  )
}
