import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiClient } from '../../lib/apiClient'
import { Button } from '../core/Button'
import { IconButton } from '../core/IconButton'
import { Icon } from '../core/Icon'
import { Alert } from '../feedback/Alert'
import { Dialog } from '../feedback/Dialog'
import './mediaPreview.css'

/**
 * What the previewer can be pointed at.
 *
 * Deliberately **not** `DriverDocument`. The first caller is a driver's
 * licence, but nothing here knows about drivers, and the second caller — an
 * applicant's KYC upload, a vehicle photograph, an odometer reading — should
 * not have to invent a driver-shaped object to reuse this.
 */
export interface MediaPreviewSource {
  /** The API path the bytes are fetched from. A route, never a storage URL. */
  url: string
  /** Used to choose a renderer, and to say why when there is none. */
  mimeType: string
  /** The handset's own name for it, shown as-is. */
  name?: string | null
  sizeBytes?: number | null
  /** Title for the dialog. Falls back to the filename. */
  title?: string
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

/**
 * A media previewer for anything the API streams behind authentication.
 *
 * ## Why it fetches instead of linking
 *
 * The endpoints it reads are authenticated on purpose — ADR-0033 §5 keeps a
 * driver's identity document behind the API precisely so that a URL alone is
 * not enough to see it. A plain `<img src>` or `<iframe src>` pointed at one
 * of those paths sends no bearer token and renders a 401 page where somebody's
 * national ID should be. So the bytes are fetched with the session, turned
 * into an object URL, and revoked when the dialog closes.
 *
 * ## Why the PDF has no library
 *
 * Chrome, Firefox, Safari and Edge all ship a PDF viewer with search, page
 * navigation, zoom and printing already built. Adding pdf.js — roughly 400 kB
 * — to reproduce them fails the `quality-control` north star on two counts at
 * once: it is bundle weight the operator pays for on every load, and it is a
 * dependency to maintain in exchange for nothing the browser was not already
 * doing. An `<iframe>` over the object URL gets all of it for free.
 *
 * The trade is real and worth stating: the viewer's chrome is the browser's,
 * so it looks slightly different in Firefox than in Chrome. A reviewer reading
 * an insurance certificate cares that the text is legible, not that the
 * toolbar matches the app's buttons.
 *
 * ## What it will not do
 *
 * **It does not guess.** A file whose type it cannot render is not shown as a
 * broken image — it gets a plain card naming the type, with a download. An
 * empty frame where a document should be is indistinguishable, to the person
 * looking at it, from a document that is missing.
 */
/**
 * Moving between documents without leaving the dialog.
 *
 * The parent owns the list — this component stays ignorant of what a driver's
 * six papers are, which is the property that lets an applicant's KYC set and a
 * vehicle's photographs reuse it. All it needs is where it is and what the two
 * arrows do.
 *
 * Reviewing a driver means comparing a selfie against an identity document and
 * a plate against a registration. Closing and reopening a dialog between each
 * pair is the friction that makes a reviewer stop comparing.
 *
 * **A parent that browses must also key this component by `source.url`.** Zoom,
 * rotation and pan belong to the document being looked at, not to the dialog,
 * and carrying a 4x zoom onto the next file shows a reviewer the corner of
 * somebody's licence and looks like a broken image. A `key` resets all of it
 * the way React intends — no reset effect, no cascading render, and the fetch
 * re-runs because the component genuinely is a new one.
 */
export interface MediaPreviewBrowse {
  /** 1-based, for the read-out. */
  position: number
  total: number
  /** Null at the ends — the dialog disables rather than wraps. */
  onPrevious: (() => void) | null
  onNext: (() => void) | null
}

export function MediaPreview({
  source,
  browse,
  actions,
  onClose,
}: {
  source: MediaPreviewSource
  browse?: MediaPreviewBrowse
  /**
   * Controls for the document on screen, rendered between the browse arrows
   * and Close.
   *
   * **Optional, and the default is still none.** A previewer is a viewer
   * first; a caller that only shows a file passes nothing and gets exactly
   * the chrome it had before.
   *
   * It exists because judging a document and acting on it are the same
   * moment. Reviewing six applicant documents meant opening one, deciding,
   * closing it, finding the row again and pressing a button — five steps for
   * a decision made in the first. The arrows are already here, so the whole
   * set can be worked through without the dialog closing once.
   */
  actions?: ReactNode
  onClose: () => void
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  /*
    `browse` is rebuilt by the parent on every render, so depending on it
    directly would tear down and re-add the keydown listener continuously. The
    ref keeps the handler stable and always current.

    Synchronised in an effect rather than assigned during render: a ref written
    in render is invisible to React's memoisation and silently opts the
    component out of it.
  */
  const browseRef = useRef(browse)

  useEffect(() => {
    browseRef.current = browse
  }, [browse])
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragFrom = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const kind = renderableKind(source.mimeType)

  useEffect(() => {
    let revoked = false
    let created: string | null = null

    apiClient
      .get<Blob>(source.url, { responseType: 'blob' })
      .then((response) => {
        // The dialog may already have closed while this was in flight; creating
        // an object URL then would leak it, because the cleanup below has
        // already run.
        if (revoked) return

        created = URL.createObjectURL(response.data)
        setObjectUrl(created)
      })
      .catch(() =>
        setError(
          'That file could not be loaded. It may have been replaced since this screen opened.',
        ),
      )

    return () => {
      revoked = true
      // **Revoked on close, not on a timer.** The object URL is a handle to
      // somebody's identity document held in this tab's memory; leaving it
      // alive for a minute after the dialog closes is a window in which a
      // script on the page could still read it.
      if (created !== null) URL.revokeObjectURL(created)
    }
  }, [source.url])

  const reset = useCallback(() => {
    setZoom(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }, [])

  const changeZoom = useCallback((delta: number) => {
    setZoom((current) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((current + delta) * 100) / 100))
      // Panning only means anything while zoomed in. Coming back to fit should
      // put the image back in the middle rather than leaving it off in a
      // corner the user then has to drag it out of.
      if (next <= 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  /**
   * Keyboard, for the whole toolbar.
   *
   * The buttons are reachable by Tab and this is in addition, not instead —
   * somebody comparing a selfie against an ID card is holding the two side by
   * side and should not have to Tab back to the zoom control between each
   * look.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key) {
        /*
          Left and right move between documents. Deliberately *not* also bound
          to PageUp/PageDown or j/k: one obvious pair of keys, matching the
          arrows the dialog draws, is learnable; four aliases are trivia.

          Guarded on `browse` so the keys do nothing at all when the dialog was
          opened over a single file — a shortcut that silently no-ops is worse
          than one that does not exist.
        */
        case 'ArrowLeft':
          browseRef.current?.onPrevious?.()
          break
        case 'ArrowRight':
          browseRef.current?.onNext?.()
          break
        case '+':
        case '=':
          changeZoom(ZOOM_STEP)
          break
        case '-':
        case '_':
          changeZoom(-ZOOM_STEP)
          break
        case '0':
          reset()
          break
        case 'r':
        case 'R':
          setRotation((current) => (current + 90) % 360)
          break
        default:
          return
      }

      event.preventDefault()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [changeZoom, reset])

  const panning = kind === 'image' && zoom > 1

  /**
   * Whether a drag is in flight, as **state** and not as the ref below.
   *
   * The cursor class used to read `dragFrom.current` during render, which
   * eslint's `react-hooks/refs` refuses — and it was right about more than
   * the rule: writing a ref schedules no render, so the grab cursor never
   * actually changed to grabbing while the pointer was down. The ref keeps
   * the drag *origin*, which genuinely should not re-render on every pixel;
   * the boolean is what the cursor needs, so it is the thing that renders.
   */
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panning) return
    dragFrom.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current
    if (from === null) return
    setOffset({ x: from.ox + (event.clientX - from.x), y: from.oy + (event.clientY - from.y) })
  }

  const endDrag = () => {
    dragFrom.current = null
    setDragging(false)
  }

  return (
    <Dialog
      open
      width={920}
      title={source.title ?? source.name ?? 'Document'}
      onClose={onClose}
      footer={
        <div className="kr-media__footer">
          {browse !== undefined && (
            <div className="kr-media__browse">
              <IconButton
                icon="chevron-left"
                label="Previous document"
                variant="outline"
                size="sm"
                disabled={browse.onPrevious === null}
                onClick={() => browse.onPrevious?.()}
              />
              {/*
                "3 of 6", not a dot strip. A reviewer working through a
                driver's papers is counting what is left, and six dots do not
                answer that at a glance.
              */}
              <span className="kr-media__zoom" aria-live="polite">
                {browse.position} of {browse.total}
              </span>
              <IconButton
                icon="chevron-right"
                label="Next document"
                variant="outline"
                size="sm"
                disabled={browse.onNext === null}
                onClick={() => browse.onNext?.()}
              />
            </div>
          )}
          {actions !== undefined && <div className="kr-media__actions">{actions}</div>}

          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="kr-media">
        {error !== null ? (
          <Alert tone="error">{error}</Alert>
        ) : (
          <>
            {kind === 'image' && (
              <div className="kr-media__toolbar">
                <IconButton
                  icon="zoom-out"
                  label="Zoom out"
                  variant="outline"
                  size="sm"
                  disabled={zoom <= ZOOM_MIN}
                  onClick={() => changeZoom(-ZOOM_STEP)}
                />
                {/*
                  A read-out rather than a slider: a reviewer wants "is this
                  legible yet", which two buttons answer, and a slider adds a
                  drag target to a dialog that already has one.
                */}
                <span className="kr-media__zoom" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <IconButton
                  icon="zoom-in"
                  label="Zoom in"
                  variant="outline"
                  size="sm"
                  disabled={zoom >= ZOOM_MAX}
                  onClick={() => changeZoom(ZOOM_STEP)}
                />
                <IconButton
                  icon="rotate-ccw"
                  label="Rotate left"
                  variant="outline"
                  size="sm"
                  onClick={() => setRotation((current) => (current + 270) % 360)}
                />
                <IconButton
                  icon="rotate-cw"
                  label="Rotate right"
                  variant="outline"
                  size="sm"
                  onClick={() => setRotation((current) => (current + 90) % 360)}
                />
                <Button size="sm" variant="ghost" onClick={reset} disabled={zoom === 1 && rotation === 0}>
                  Fit
                </Button>
                <span className="kr-media__spacer" />
                <span className="kr-media__zoom" aria-hidden="true">
                  + − R 0
                </span>
              </div>
            )}

            <div
              className={[
                'kr-media__stage',
                panning ? (dragging ? 'kr-media__stage--grabbing' : 'kr-media__stage--grab') : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {objectUrl === null ? (
                <div className="kr-media__placeholder">
                  <Icon name="loader-circle" size={20} aria-hidden />
                  <span>Loading…</span>
                </div>
              ) : kind === 'image' ? (
                <img
                  className="kr-media__image"
                  src={objectUrl}
                  /*
                    The filename, not "document preview". A screen reader user
                    comparing four uploads needs to know which one this is, and
                    the alt text is the only place that distinction lives.
                  */
                  alt={source.name ?? source.title ?? 'Uploaded document'}
                  draggable={false}
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                  }}
                />
              ) : kind === 'pdf' ? (
                <iframe
                  className="kr-media__frame"
                  src={objectUrl}
                  title={source.name ?? source.title ?? 'PDF document'}
                />
              ) : (
                <div className="kr-media__placeholder">
                  <Icon name="file" size={28} aria-hidden />
                  <div>
                    <strong>This file cannot be shown here.</strong>
                    <p style={{ margin: 'var(--space-2) 0 0' }}>
                      It is a <code>{source.mimeType}</code>, which the browser has no viewer
                      for. Download it to open it in something that does.
                    </p>
                  </div>
                  <DownloadButton objectUrl={objectUrl} name={source.name ?? 'document'} />
                </div>
              )}
            </div>

            <dl className="kr-media__meta">
              {source.name != null && source.name !== '' && (
                <div>
                  <dt>File</dt>
                  <dd className="kr-media__filename">{source.name}</dd>
                </div>
              )}
              <div>
                <dt>Type</dt>
                <dd>{source.mimeType}</dd>
              </div>
              {typeof source.sizeBytes === 'number' && (
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(source.sizeBytes)}</dd>
                </div>
              )}
            </dl>
          </>
        )}
      </div>
    </Dialog>
  )
}

/**
 * Which renderer, decided from the mime type the server reported.
 *
 * **The server's type, never the filename's extension.** `StoreDriverDocument`
 * sniffs the uploaded bytes, and a handset that names a PDF `licence.jpg` — a
 * common picker quirk — would otherwise be rendered as a broken image.
 */
function renderableKind(mimeType: string): 'image' | 'pdf' | 'other' {
  const type = mimeType.toLowerCase()

  if (type === 'application/pdf') return 'pdf'

  // The list the upload accepts, and no wider. `image/*` would also match
  // `image/svg+xml`, and an SVG is a script host — rendering one fetched from
  // an unprivileged uploader inside the console is a stored-XSS surface, even
  // through an object URL.
  if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(type)) {
    return 'image'
  }

  return 'other'
}

/**
 * Saves the fetched blob.
 *
 * An `<a download>` over the **object URL**, not over the API path: the API
 * path needs a bearer the browser's own download request would not send, and
 * the bytes are already here.
 */
function DownloadButton({ objectUrl, name }: { objectUrl: string; name: string }) {
  return (
    <a
      href={objectUrl}
      download={name}
      /*
       * A real `<a download>`, not a Button wrapping one. Downloading is
       * navigation, and an anchor gets the keyboard behaviour, the context
       * menu and "save link as" for free — all of which a button would have
       * to re-earn and none of which it would get right.
       */
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: 'var(--control-h-sm)',
        padding: '0 12px',
        borderRadius: 'var(--radius-control)',
        border: '1px solid var(--border-default)',
        background: 'var(--surface-card)',
        color: 'var(--text-body)',
        font: 'var(--type-label)',
        textDecoration: 'none',
      }}
    >
      <Icon name="download" size={14} aria-hidden />
      Download
    </a>
  )
}

/** Binary units, because a file manager will report the same number. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
