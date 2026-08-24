import { useId, useState } from 'react'
import { usePlaceSearch } from '../../lib/usePlaceSearch'
import { currentLocationPlace, placeLabel, type PlaceHit } from '../../pages/public/places'
import { Icon } from '../core/Icon'
import { IconButton } from '../core/IconButton'
import { FormField } from './FormField'
import { Input } from './Input'

/**
 * An address box with geocoder suggestions, in the operator console's own
 * visual language (ADR-0020 §2).
 *
 * The public order flow has had one of these since it shipped; the internal
 * booking dialog had a plain text input, so a dispatcher raising a booking
 * by hand produced one with **no coordinates** — and the matcher duly
 * reported "pickup has no coordinates, so distance was not used" for every
 * booking staff created.
 *
 * ## Why this is not the public component
 *
 * `PlaceSearch` in the order flow is Tailwind-styled for a consumer journey:
 * pill radii, brand-green accents, a full-width suggestion sheet. This
 * console is built from `FormField` and `Input` over design tokens. Forcing
 * one component to serve both would make it worse at each.
 *
 * What is genuinely shared — the debounce, the abort, the minimum length,
 * and the rule that only typed text is searched — lives in
 * `usePlaceSearch`, which both call. That is the duplication AGENTS.md's
 * "never duplicate UI" rule is actually about.
 *
 * ## Free text always stands
 *
 * Picking a suggestion is an accelerator, never a requirement. A dispatcher
 * on the phone types what the caller says and moves on; the booking is
 * created with the text alone and the recommender says distance was not
 * used. Refusing to submit without a picked place would put a geocoder
 * between an operator and their work.
 */
export function PlaceField({
  label,
  value,
  placeholder,
  hint,
  error,
  required = false,
  locatable = false,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  hint?: string
  error?: string
  required?: boolean
  /**
   * Offers the crosshair that fills this box from the device's position.
   *
   * **Opt-in, and on pick-up only.** "Where am I" is a question about the
   * person holding the device, and the dispatcher holding it is not the
   * passenger — but on a pick-up it is still the right shortcut, because the
   * desk and the caller are usually in the same place and the driver has to
   * reach the desk either way. On a destination it would be plainly wrong:
   * nobody orders a car to where they already are.
   */
  locatable?: boolean
  /**
   * `place` is the suggestion that was taken, or null when the text was
   * typed. The caller keeps it so it can send coordinates only while the
   * text still matches — see `orderCoordinates.ts`.
   */
  onChange: (value: string, place: PlaceHit | null) => void
}) {
  const id = useId()
  const { hits, markTyped, settle } = usePlaceSearch(value)
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)

  const take = (hit: PlaceHit) => {
    settle()
    setOpen(false)
    // `placeLabel`, not a hand-rolled join. `coordinatesFor` decides
    // whether to send the coordinates by comparing the field's text to
    // this exact label — spelling it differently here silently dropped
    // every point, which is the bug this component exists to fix.
    onChange(placeLabel(hit), hit)
  }

  /**
   * The device's own position, as a picked place.
   *
   * `currentLocationPlace()` reverse-geocodes and **never rejects** — a
   * refused prompt, a timeout or a geocoder outage all resolve to null, and
   * the field is left exactly as the person had it. That is the whole error
   * handling: there is nothing useful to say about a browser permission the
   * page cannot grant itself, and an alert over a working text box would be
   * noise in front of somebody who can simply type.
   *
   * It goes through `take()` rather than setting the text directly, so it
   * lands as a **picked place** with coordinates — which is the entire point.
   * A pickup typed as "Current location" with no point behind it is the
   * no-coordinates booking this component was built to stop.
   */
  const locate = async () => {
    setLocating(true)

    try {
      const here = await currentLocationPlace()

      if (here !== null) take(here)
    } finally {
      setLocating(false)
    }
  }

  const showing = open && hits.length > 0

  return (
    <FormField label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <div style={{ position: 'relative' }}>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showing}
          aria-controls={showing ? `${id}-suggestions` : undefined}
          onChange={(event) => {
            markTyped()
            setOpen(true)
            // Typing invalidates any place that was picked: the caller must
            // stop sending its coordinates the moment the text diverges.
            onChange(event.target.value, null)
          }}
          onBlur={() => {
            // Deferred, or the blur fires before the suggestion's click and
            // the list closes out from under the pointer.
            setTimeout(() => setOpen(false), 150)
          }}
          required={required}
          // Room for the crosshair, or a long address runs under it.
          style={locatable ? { paddingInlineEnd: 40 } : undefined}
        />

        {locatable && (
          <span
            style={{
              position: 'absolute',
              insetInlineEnd: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'inline-flex',
            }}
          >
            <IconButton
              icon={locating ? 'loader-circle' : 'crosshair'}
              label="Use my current location"
              size="sm"
              disabled={locating}
              // `onMouseDown` with the default prevented, for the reason the
              // suggestion buttons below give: the input's blur would
              // otherwise fire first and this would resolve against a field
              // that had already closed its list.
              onMouseDown={(event) => {
                event.preventDefault()
                void locate()
              }}
            />
          </span>
        )}

        {showing && (
          <ul
            id={`${id}-suggestions`}
            role="listbox"
            style={{
              position: 'absolute',
              zIndex: 20,
              insetInline: 0,
              marginTop: 4,
              maxHeight: 260,
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
              <li key={`${hit.name}|${hit.detail}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  // `onMouseDown`, not `onClick`: the input's blur would
                  // otherwise unmount this list before the click landed,
                  // and picking a suggestion would do nothing.
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
                  <Icon name="map-pin" size={16} style={{ color: 'var(--text-secondary)' }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 'var(--weight-medium)' }}>
                      {hit.name}
                    </span>
                    {hit.detail !== '' && (
                      <span
                        style={{
                          display: 'block',
                          font: 'var(--type-caption)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {hit.detail}
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
