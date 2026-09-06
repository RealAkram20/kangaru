import { useEffect, useState } from 'react'
import { Dialog } from '../../components/feedback/Dialog'
import { Icon } from '../../components/core/Icon'
import { apiClient } from '../../lib/apiClient'

/**
 * The dashboard photograph behind an odometer reading (ADR-0016), fetched
 * with the caller's token — `GET /trips/{id}/odometer-photo/{start|end}`
 * streams the file behind `TripPolicy::view`, so a plain `<img src>` would
 * be refused. A thumbnail that opens full-size on click.
 *
 * Three honest states, none of which is a placeholder image: loading, the
 * photo, or "no photo was captured for this reading" — the API's 404 for a
 * reading typed without a photo. A client reading this page must be able
 * to tell a missing photo from a slow one.
 */
export function OdometerPhoto({ tripId, moment, label }: { tripId: number; moment: 'start' | 'end'; label: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    apiClient
      .get<Blob>(`/trips/${tripId}/odometer-photo/${moment}`, { responseType: 'blob' })
      .then((response) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(response.data)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [tripId, moment])

  if (url === undefined) {
    return <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>Loading photo…</span>
  }

  if (url === null) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          font: 'var(--type-caption)',
          color: 'var(--text-secondary)',
        }}
      >
        <Icon name="image-off" size={14} />
        No dashboard photo captured for this reading
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open the ${label.toLowerCase()} dashboard photo`}
        style={{
          alignSelf: 'flex-start',
          padding: 0,
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--surface-sunken)',
          cursor: 'zoom-in',
          overflow: 'hidden',
          lineHeight: 0,
        }}
      >
        <img src={url} alt={`${label} dashboard photo`} style={{ display: 'block', width: 160, height: 100, objectFit: 'cover' }} />
      </button>
      {open && (
        <Dialog title={`${label} — dashboard photo`} onClose={() => setOpen(false)} width={880}>
          <img src={url} alt={`${label} dashboard photo, full size`} style={{ display: 'block', maxWidth: '100%', borderRadius: 'var(--radius-card)' }} />
        </Dialog>
      )}
    </>
  )
}
