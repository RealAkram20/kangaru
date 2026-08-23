import { useId, useState } from 'react'
import { useColleagueSearch } from '../../lib/useColleagueSearch'
import type { Colleague } from '../../types/staff'
import { Icon } from '../core/Icon'
import { FormField } from './FormField'
import { Input } from './Input'

/**
 * The passenger box on a client's booking: type a few letters, pick the
 * colleague.
 *
 * ## Why not a `<select>`
 *
 * A bank's staff list is thousands of accounts. A dropdown holding all of
 * them is a slow dialog and an unusable picker, and it hands the whole
 * directory to anybody who opens the form. So the list is fetched as the
 * person types, capped by the server, and scoped by the server to the
 * caller's own organisation — the screen never learns that rule.
 *
 * ## Why picking is required here and optional in `PlaceField`
 *
 * An address is whatever the caller said; a passenger is an account. The
 * whole point of naming a colleague is that "J. Mukasa" and "Joseph Mukasa"
 * stop being two passengers, so typing over a chosen name clears the choice
 * and the dialog will not submit until one is made again. The *number* is
 * still editable beside this field — the account's is prefilled, and the
 * person raising the booking may know a better one for today.
 */
export function ColleagueField({
  value,
  chosen,
  error,
  onChange,
}: {
  /** What is in the box. Held by the caller, like every other field here. */
  value: string
  /** The colleague currently chosen, or null while the text is unresolved. */
  chosen: Colleague | null
  error?: string
  /** `colleague` is null when the text was typed rather than picked. */
  onChange: (value: string, colleague: Colleague | null) => void
}) {
  const id = useId()
  const { hits, markTyped, settle } = useColleagueSearch(value)
  const [open, setOpen] = useState(false)

  const take = (hit: Colleague) => {
    settle()
    setOpen(false)
    onChange(hit.name, hit)
  }

  const showing = open && hits.length > 0

  return (
    <FormField label="Passenger" htmlFor={id} required error={error}>
      <div style={{ position: 'relative' }}>
        <Input
          id={id}
          value={value}
          placeholder="Search your colleagues"
          autoComplete="off"
          role="combobox"
          aria-expanded={showing}
          aria-controls={showing ? `${id}-list` : undefined}
          iconLeft={chosen ? 'circle-check' : 'search'}
          onChange={(event) => {
            markTyped()
            setOpen(true)
            // Typing invalidates the choice: the id and the name on screen
            // must never be able to disagree.
            onChange(event.target.value, null)
          }}
          onBlur={() => {
            // Deferred, or the blur fires before the option's click and the
            // list closes out from under the pointer.
            setTimeout(() => setOpen(false), 150)
          }}
          required
        />

        {showing && (
          <ul
            id={`${id}-list`}
            role="listbox"
            style={{
              position: 'absolute',
              zIndex: 20,
              insetInline: 0,
              marginTop: 4,
              maxHeight: 240,
              overflowY: 'auto',
              listStyle: 'none',
              padding: 'var(--space-1)',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {hits.map((hit) => (
              <li key={hit.id} role="option" aria-selected={hit.id === chosen?.id}>
                <button
                  type="button"
                  // `onMouseDown`, not `onClick`: the input's blur would
                  // otherwise unmount this list before the click landed,
                  // and picking a colleague would do nothing.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    take(hit)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    width: '100%',
                    padding: 'var(--space-2)',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    font: 'var(--type-body-dense)',
                    color: 'var(--text-body)',
                    textAlign: 'left',
                  }}
                >
                  <Icon name="user" size={16} style={{ color: 'var(--text-secondary)' }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 'var(--weight-medium)' }}>
                      {hit.name}
                    </span>
                    {hit.phone !== null && (
                      <span
                        style={{
                          display: 'block',
                          font: 'var(--type-caption)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {hit.phone}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormField>
  )
}
