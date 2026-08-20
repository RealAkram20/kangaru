import { useId, useState } from 'react'
import { Icon } from '../../components/core/Icon'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { usePlaceSearch } from '../../lib/usePlaceSearch'
import { placeLabel, type PlaceHit } from '../public/places'
import type { ClientPlace } from './routeBuilder'

/**
 * One box that adds a stop, whichever kind of stop it is (ADR-0045).
 *
 * ## Why saved places and the geocoder share a control
 *
 * The alternative was a permanent "saved places" panel to drag from, which
 * costs a whole column of screen to do what a search box does in fewer
 * actions. More importantly it splits one intent — *put the Nakawa ATM on
 * this route* — across two interactions depending on whether the officer
 * happened to pin it last week.
 *
 * So both are searched at once. **The client's own places rank first**,
 * badged and matched locally so they appear on the first keystroke, and the
 * geocoder fills in below them after its debounce. Picking a geocoder hit
 * adds the stop *and* offers to save the place — which is how the ATM
 * register builds itself as a by-product of the work, rather than as a
 * chore somebody has to complete before they can start.
 *
 * The debounce, the abort, the three-character minimum and the "only search
 * what the user typed" rule all come from `usePlaceSearch`, which the public
 * order flow and the booking dialog already share. This adds no fourth copy.
 */
export function AddStopField({
  places,
  onAddSaved,
  onAddNew,
  disabled = false,
}: {
  /** The client's register, already loaded by the page. */
  places: ClientPlace[]
  onAddSaved: (place: ClientPlace) => void
  /** A geocoder hit the client has not pinned before. */
  onAddNew: (hit: PlaceHit & { lngLat: [number, number] }) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const { hits, markTyped, settle } = usePlaceSearch(value)
  const listId = useId()

  const query = value.trim().toLowerCase()

  // Local, so a place the officer pinned five minutes ago is offered on the
  // first keystroke rather than after a 300ms round trip to a geocoder that
  // has never heard of it.
  const saved =
    query === ''
      ? []
      : places
          .filter((place) => place.is_active)
          .filter(
            (place) =>
              place.name.toLowerCase().includes(query) ||
              (place.address ?? '').toLowerCase().includes(query),
          )
          .slice(0, 5)

  // Only hits that came back with coordinates can become a stop. A place is
  // a pin on this screen (see the `client_places` migration), and an
  // unlocatable suggestion would add a row the map cannot draw.
  const located = hits.filter(
    (hit): hit is PlaceHit & { lngLat: [number, number] } => hit.lngLat !== undefined,
  )

  const take = (add: () => void) => {
    add()
    setValue('')
    // `settle` is what keeps the list closed after a pick. Without it the
    // hook would search the emptied box's previous value and drop the
    // suggestions back over a field the officer has already finished with.
    settle()
  }

  return (
    <div style={{ position: 'relative' }}>
      <FormField label="Add a stop" htmlFor={listId}>
        <Input
          id={listId}
          value={value}
          disabled={disabled}
          placeholder="Search your places, or anywhere in Uganda"
          iconLeft="search"
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value)
            markTyped()
          }}
        />
      </FormField>

      {(saved.length > 0 || located.length > 0) && (
        <ul
          aria-label="Matching places"
          style={{
            listStyle: 'none',
            margin: 'var(--space-1) 0 0',
            padding: 'var(--space-1)',
            display: 'grid',
            gap: 2,
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {saved.map((place) => (
            <li key={`saved-${place.id}`}>
              <Suggestion
                icon="map-pin-check"
                title={place.name}
                detail={place.address ?? ''}
                badge="Saved"
                onSelect={() => take(() => onAddSaved(place))}
              />
            </li>
          ))}
          {located.map((hit, index) => (
            <li key={`hit-${index}-${hit.name}`}>
              <Suggestion
                icon="map-pin"
                title={hit.name}
                detail={placeLabel(hit)}
                onSelect={() => take(() => onAddNew(hit))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Suggestion({
  icon,
  title,
  detail,
  badge,
  onSelect,
}: {
  icon: string
  title: string
  detail: string
  badge?: string
  onSelect: () => void
}) {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2)',
        background: hover ? 'var(--surface-subtle)' : 'transparent',
        border: 0,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={16} style={{ color: 'var(--text-secondary)', flex: '0 0 auto' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            font: 'var(--type-body)',
            color: 'var(--text-body)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {detail !== '' && (
          <span
            style={{
              display: 'block',
              font: 'var(--type-caption)',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {detail}
          </span>
        )}
      </span>
      {badge !== undefined && (
        // Badged rather than merely ordered first: "these are yours" is a
        // fact about the row, and ordering alone carries meaning by position
        // — which a screen reader reading one option at a time cannot hear.
        <span
          style={{
            flex: '0 0 auto',
            font: 'var(--type-caption)',
            color: 'var(--text-accent)',
            background: 'var(--surface-accent)',
            borderRadius: 'var(--radius-badge)',
            padding: '2px var(--space-2)',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
