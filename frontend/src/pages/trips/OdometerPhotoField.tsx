import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/core/Icon'

/**
 * Captures the dashboard photo that accompanies an odometer reading.
 *
 * PROJECT.md's anchor-client requirement is "driver-entered value plus a
 * dashboard photo" — the reading on its own is a number somebody typed, and
 * the photo is what makes it checkable.
 *
 * `capture="environment"` matters more than it looks: on a phone it opens
 * the rear camera directly instead of a file browser. The person using this
 * is a driver at a vehicle, in the dark, possibly in the rain. One tap.
 */
export function OdometerPhotoField({
  file,
  onChange,
  disabled = false,
}: {
  file: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  // Object URLs are held until revoked; without this every retake leaks a
  // full-size phone photo for as long as the dialog is open.
  useEffect(() => {
    if (preview === null) {
      return
    }

    return () => URL.revokeObjectURL(preview)
  }, [preview])

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        style={{ display: 'none' }}
      />

      {preview && file ? (
        // Keyed by the object URL so a retake remounts: the entry state
        // then comes from mounting rather than from resetting a flag,
        // which is both simpler and what makes each new photo animate.
        <Thumbnail
          key={preview}
          url={preview}
          file={file}
          disabled={disabled}
          onRetake={() => inputRef.current?.click()}
          onRemove={() => onChange(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            width: '100%',
            height: 'var(--control-h-lg)',
            // Dashed, because it is a slot waiting to be filled rather than
            // an action that commits anything.
            border: '1px dashed var(--border-input)',
            borderRadius: 'var(--radius-control)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            font: 'var(--type-label)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'var(--transition-control)',
          }}
        >
          <Icon name="camera" size={16} />
          Capture dashboard photo
        </button>
      )}
    </div>
  )
}

/**
 * The captured photo, its size, and the two things you can do to it.
 *
 * Enters with opacity and a 0.98 scale — never from `scale(0)`, because
 * nothing in the real world appears out of nothing. Just enough to read as
 * "this arrived" without asking to be looked at.
 */
function Thumbnail({
  url,
  file,
  disabled,
  onRetake,
  onRemove,
}: {
  url: string
  file: File
  disabled: boolean
  onRetake: () => void
  onRemove: () => void
}) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    // Next frame, so the browser paints the "from" state before the
    // transition starts. Setting it in the same tick skips the animation.
    const raf = requestAnimationFrame(() => setShown(true))

    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        opacity: shown ? 1 : 0,
        transform: shown ? 'scale(1)' : 'scale(0.98)',
        // Only opacity and transform: both skip layout and paint.
        transition:
          'opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)',
      }}
    >
      <img
        src={url}
        alt="Dashboard photo about to be submitted with this reading"
        style={{
          width: 56,
          height: 56,
          objectFit: 'cover',
          borderRadius: 'var(--radius-sm, 4px)',
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            font: 'var(--type-body-dense)',
            color: 'var(--text-body)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.name}
        </p>
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          {Math.round(file.size / 1024).toLocaleString('en-US')} KB
        </p>
      </div>
      <PhotoAction icon="rotate-ccw" label="Retake photo" onClick={onRetake} disabled={disabled} />
      <PhotoAction icon="x" label="Remove photo" onClick={onRemove} disabled={disabled} />
    </div>
  )
}

/**
 * Icon-only control inside the thumbnail row.
 *
 * Not the shared Button: at 28px this sits below every size that component
 * offers, and forcing it in would mean overriding most of what it sets.
 * It keeps the press feedback, which is the part that matters.
 */
function PhotoAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled: boolean
}) {
  const [pressed, setPressed] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        flexShrink: 0,
        border: 'none',
        background: 'transparent',
        color: 'var(--text-secondary)',
        borderRadius: 'var(--radius-sm, 4px)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transform: pressed ? 'scale(0.92)' : 'scale(1)',
        transition: 'transform var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-standard)',
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  )
}
