import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '../../components/core/Icon'
import { IconButton } from '../../components/core/IconButton'
import { reorder, type DraftStop } from './routeBuilder'

/**
 * The itinerary: the circuit's stops, in the order they are driven
 * (ADR-0045 §1).
 *
 * ## Three ways to reorder, one function underneath
 *
 * Drag, keyboard, and the move-up/move-down buttons all end in
 * `reorder()`. They are not alternatives to each other: **WCAG AA makes the
 * keyboard path mandatory**, so a drag-only rail was never an option, and
 * `@dnd-kit`'s `KeyboardSensor` was chosen precisely because it supplies
 * that path — space to lift, arrows to move, space to drop, escape to
 * cancel — with the screen-reader announcements that make it usable rather
 * than merely reachable.
 *
 * The visible buttons stay anyway. They are discoverable in a way a lift
 * gesture is not, and on a 12-stop circuit "down, down, down" is genuinely
 * faster than dragging past a scroll boundary.
 *
 * ## What does not animate
 *
 * The sequence badges renumber instantly. `docs/screen-rules.md` §5 bans
 * decoration on a surface seen constantly, and a number that tweens while
 * somebody is reading it is worse than one that simply changes: the officer
 * is checking that ATM 4 is now third, and an in-between frame showing "4"
 * is a wrong answer rendered convincingly.
 *
 * The lift itself does animate, because it is feedback rather than
 * decoration — `transform` and `opacity` only, and `dnd-kit`'s own
 * transition string, which is already inside the 300ms ceiling.
 */
export function StopRail({
  stops,
  onChange,
  onRemove,
  disabled = false,
}: {
  stops: DraftStop[]
  onChange: (next: DraftStop[]) => void
  onRemove: (key: string) => void
  disabled?: boolean
}) {
  // A small activation distance so a click on the remove button inside a
  // draggable row is not swallowed as a two-pixel drag — the failure that
  // makes a list feel broken rather than fussy.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const move = (from: number, to: number) => {
    const next = reorder(stops, from, to)
    if (next !== stops) onChange(next)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    // A drop outside the rail: `over` is null and the drag is a cancel.
    if (over === null || active.id === over.id) return

    move(
      stops.findIndex((stop) => stop.key === active.id),
      stops.findIndex((stop) => stop.key === over.id),
    )
  }

  if (stops.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--space-8) var(--space-4)',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          font: 'var(--type-body)',
          border: '1px dashed var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <Icon name="map-pin" size={24} style={{ color: 'var(--text-placeholder)' }} />
        <p style={{ margin: 'var(--space-2) 0 0' }}>No stops yet</p>
        <p style={{ margin: 'var(--space-1) 0 0', font: 'var(--type-caption)' }}>
          Search for a place below, or click the map to pin one.
        </p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up stop ${position(stops, active.id)}.`,
          onDragOver: ({ active, over }) =>
            over === null
              ? `Stop ${position(stops, active.id)} is no longer over a position.`
              : `Stop ${position(stops, active.id)} moved to position ${position(stops, over.id)}.`,
          onDragEnd: ({ active, over }) =>
            over === null
              ? `Stop ${position(stops, active.id)} was dropped and stays where it was.`
              : `Stop ${position(stops, active.id)} dropped at position ${position(stops, over.id)}.`,
          onDragCancel: ({ active }) =>
            `Moving stop ${position(stops, active.id)} was cancelled. It stays where it was.`,
        },
      }}
    >
      <SortableContext items={stops.map((s) => s.key)} strategy={verticalListSortingStrategy}>
        <ol
          aria-label="Stops on this route, in order"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}
        >
          {stops.map((stop, index) => (
            <StopCard
              key={stop.key}
              stop={stop}
              index={index}
              total={stops.length}
              disabled={disabled}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => onRemove(stop.key)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

/** 1-based, for a sentence a person hears rather than an array index. */
function position(stops: DraftStop[], id: string | number): number {
  return stops.findIndex((stop) => stop.key === id) + 1
}

function StopCard({
  stop,
  index,
  total,
  disabled,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  stop: DraftStop
  index: number
  total: number
  disabled: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.key,
    disabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{
        // transform + opacity only (screen-rules §5). `dnd-kit` supplies the
        // transition; nothing here invents a curve.
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--surface-card)',
        border: `1px solid ${isDragging ? 'var(--border-accent)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: isDragging ? 'var(--shadow-md)' : 'var(--shadow-none)',
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        // The lift target. `dnd-kit` puts the keyboard behaviour on these
        // props, so this must be a real focusable button — a styled div with
        // a grip icon is the version of this control that cannot be used
        // without a mouse.
        aria-label={`Reorder ${stop.place.name}, currently stop ${index + 1} of ${total}`}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'transparent',
          border: 0,
          padding: 'var(--space-1)',
          cursor: disabled ? 'not-allowed' : 'grab',
          color: 'var(--text-secondary)',
          touchAction: 'none',
        }}
      >
        <Icon name="grip-vertical" size={16} />
      </button>

      <span
        aria-hidden="true"
        style={{
          flex: '0 0 auto',
          width: 24,
          height: 24,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--surface-accent)',
          color: 'var(--text-accent)',
          font: 'var(--type-caption)',
          fontWeight: 'var(--weight-semibold)',
        }}
      >
        {index + 1}
      </span>

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
          {stop.place.name}
        </span>
        {stop.place.address !== null && (
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
            {stop.place.address}
          </span>
        )}
      </span>

      {/* The keyboard path WCAG requires, and the discoverable one. Disabled
          at the ends rather than hidden, so the control does not move under
          somebody's cursor as they work down the list. */}
      <IconButton
        icon="arrow-up"
        label={`Move ${stop.place.name} up`}
        size="sm"
        variant="ghost"
        disabled={disabled || index === 0}
        onClick={onMoveUp}
      />
      <IconButton
        icon="arrow-down"
        label={`Move ${stop.place.name} down`}
        size="sm"
        variant="ghost"
        disabled={disabled || index === total - 1}
        onClick={onMoveDown}
      />
      <IconButton
        icon="x"
        label={`Remove ${stop.place.name} from this route`}
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={onRemove}
      />
    </li>
  )
}
