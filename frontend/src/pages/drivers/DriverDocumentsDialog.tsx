import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import type { ApiSuccess } from '../../types/api'
import type { Driver } from '../../types/driver'
import type {
  DriverDocument,
  DriverDocumentCompliance,
  DriverDocumentSlot,
} from '../../types/driverDocument'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { MediaPreview } from '../../components/media/MediaPreview'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'

type Envelope = ApiSuccess<DriverDocumentSlot[]> & { meta?: { compliance: DriverDocumentCompliance } }

/**
 * Where the office reads a driver's papers and decides (ADR-0033 §4).
 *
 * **This ships in the same change as the feature, and that is deliberate.**
 * ADR-0029 created an obligation for the office and gave it no surface; ten
 * months later nothing had ever recorded a settlement, and ADR-0032 had to be
 * written to close the loop. A verification queue with no screen would repeat
 * that exactly: drivers uploading licences nobody could accept, and a profile
 * screen permanently reading "waiting for the office".
 *
 * **Nothing here verifies automatically.** No OCR, no third-party check, and
 * no rule that accepts a document because its expiry is in the future. A
 * person looks, and a person decides.
 */
export function DriverDocumentsDialog({
  driver,
  onClose,
  onReviewed,
}: {
  driver: Driver
  onClose: () => void
  onReviewed?: () => void
}) {
  const [slots, setSlots] = useState<DriverDocumentSlot[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<DriverDocument | null>(null)

  /**
   * Which document the previewer is showing, by index into `held` below.
   *
   * **Hoisted out of the row.** Each row used to own its own previewer, which
   * made every open a dead end: a reviewer comparing a selfie against an
   * identity document had to close one dialog and open another, losing the
   * zoom and their place. The index lives here because browsing is a fact
   * about the *set*, and a row cannot know what comes after it.
   */
  const [previewAt, setPreviewAt] = useState<number | null>(null)

  /** The slot the office is filing a document into, if any (ADR-0052 §5). */
  const [uploadingTo, setUploadingTo] = useState<DriverDocumentSlot | null>(null)

  const load = useCallback(
    () =>
      apiClient
        .get<Envelope>(`/drivers/${driver.id}/documents`)
        .then((response) => {
          setSlots(response.data.data)
          setMessage(null)
        })
        .catch((failure) => setMessage(apiError(failure, 'Could not load this driver’s documents.').message)),
    [driver.id],
  )

  // `.then()` rather than `await` in an async effect body, for the reason
  // `DriversPage` records: the lint reads a synchronous call to a state setter
  // as a set during render, and the promise chain is what defers it.
  useEffect(() => {
    void load()
  }, [load])

  const review = async (document: DriverDocument, action: 'verify' | 'reject', reason?: string) => {
    setBusy(document.id)

    try {
      await apiClient.post(
        `/drivers/${driver.id}/documents/${document.id}/${action}`,
        action === 'reject' ? { reason } : undefined,
      )
      await load()
      setRejecting(null)
      onReviewed?.()
    } catch (failure) {
      setMessage(apiError(failure, 'Could not record that decision.').message)
    } finally {
      setBusy(null)
    }
  }

  /*
    Only the slots with a file, in the order the server sent them. The
    previewer browses documents, not empty rows — an arrow that lands on "Not
    sent" is an arrow that wasted a click.
  */
  const held = (slots ?? []).filter((slot) => slot.document !== null)

  const previewing = previewAt === null ? null : held[previewAt]

  return (
    <Dialog
      open
      title={`${driver.name}’s documents`}
      description="Check each file against the driver's record. Nothing is automatic."
      onClose={onClose}
      width={720}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {message && (
        <Alert tone="error" title="Documents" onDismiss={() => setMessage(null)}>
          {message}
        </Alert>
      )}

      {slots === null ? (
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {slots.map((slot) => (
            <DocumentRow
              key={slot.type}
              slot={slot}
              busy={busy === slot.document?.id}
              onOpen={() => setPreviewAt(held.findIndex((other) => other.type === slot.type))}
              onUpload={() => setUploadingTo(slot)}
              onVerify={() => slot.document && void review(slot.document, 'verify')}
              onReject={() => slot.document && setRejecting(slot.document)}
            />
          ))}
        </div>
      )}

      {previewing?.document != null && previewAt !== null && (
        <MediaPreview
          /*
            Keyed by the document, so moving to the next one remounts rather
            than mutating: zoom, rotation and pan reset to fit, which is what
            "show me the next paper" means. Without it a reviewer arrives at
            the next licence already zoomed into a corner of the last.
          */
          key={previewing.document.id}
          source={{
            // The route, built here rather than taken from `file_url`, for the
            // reason ADR-0033 §5 gives: the bytes are fetched with the session
            // and never addressed by a URL alone.
            url: `/drivers/${driver.id}/documents/${previewing.document.id}/file`,
            mimeType: previewing.document.mime_type,
            name: previewing.document.original_name,
            sizeBytes: previewing.document.size_bytes,
            title: previewing.type_label,
          }}
          browse={{
            position: previewAt + 1,
            total: held.length,
            // Null at the ends rather than wrapping. A reviewer working through
            // six papers needs to know when they have seen them all, and a
            // silent wrap round to the first is how somebody reads four of six
            // twice and the last two never.
            onPrevious: previewAt > 0 ? () => setPreviewAt(previewAt - 1) : null,
            onNext: previewAt < held.length - 1 ? () => setPreviewAt(previewAt + 1) : null,
          }}
          onClose={() => setPreviewAt(null)}
        />
      )}

      {uploadingTo !== null && (
        <UploadDocumentDialog
          driverId={driver.id}
          slot={uploadingTo}
          onCancel={() => setUploadingTo(null)}
          onFiled={() => {
            setUploadingTo(null)
            void load()
            onReviewed?.()
          }}
        />
      )}

      {rejecting !== null && (
        <RejectDialog
          document={rejecting}
          busy={busy === rejecting.id}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => void review(rejecting, 'reject', reason)}
        />
      )}
    </Dialog>
  )
}

// `error`, not `danger` — `Badge`'s tones are neutral | success | warning |
// error | info | brand, and the driver app's `danger` token has no counterpart
// here. Typed against Badge's own prop rather than a hand-written union, so a
// tone the component does not accept cannot be written again.
const TONE: Record<string, ComponentProps<typeof Badge>['tone']> = {
  verified: 'success',
  pending: 'warning',
  rejected: 'error',
  expired: 'error',
  missing: 'neutral',
}

function DocumentRow({
  slot,
  busy,
  onOpen,
  onUpload,
  onVerify,
  onReject,
}: {
  slot: DriverDocumentSlot
  busy: boolean
  /** Opens the shared previewer at this document, browsable across the set. */
  onOpen: () => void
  /** Files a new file into this slot, replacing anything held (ADR-0052 §5). */
  onUpload: () => void
  onVerify: () => void
  onReject: () => void
}) {
  const document = slot.document

  // Reads `compliance_state`, never `status`. A verified licence past its date
  // still carries `status: 'verified'` because nothing wrote to the row, and
  // showing that would tell a reviewer a lapsed licence is in order.
  const state = document === null ? 'missing' : document.compliance_state

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <strong>{slot.type_label}</strong>
          <Badge tone={TONE[state] ?? 'neutral'}>
            {document === null ? 'Not sent' : state === 'expired' ? 'Expired' : document.status_label}
          </Badge>
        </div>

        <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
          {document === null
            ? slot.hint
            : document.compliance_state === 'rejected' && document.rejection_reason !== null
              ? document.rejection_reason
              : document.expires_at === null
                ? `Sent ${new Date(document.uploaded_at).toLocaleDateString()}`
                : `${document.expired ? 'Expired' : 'Expires'} ${document.expires_at}`}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
        {/*
          **On every row, held or not.** An empty slot is precisely where the
          office needs this: a driver who handed their licence across the
          counter has no row to replace, and before this button their document
          could only reach the platform from their own phone.
        */}
        <Button size="sm" variant="ghost" onClick={onUpload} disabled={busy}>
          {document === null ? 'Upload' : 'Replace'}
        </Button>

        {document !== null && (
          <>
            <Button size="sm" variant="secondary" onClick={onOpen}>
              View
            </Button>
            <Button size="sm" onClick={onVerify} disabled={busy}>
              Verify
            </Button>
            <Button size="sm" variant="destructive" onClick={onReject} disabled={busy}>
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The office filing a document a driver handed over in person (ADR-0052 §5).
 *
 * ## Why this exists at all
 *
 * Until now the only way a document reached this platform was the handset in
 * a driver's own pocket — the same gap ADR-0048 found for driver *creation*:
 * the API could do it and no human could. A rider who photographs their
 * licence badly six times and gives up, or who emails a scan to the office,
 * had no route in.
 *
 * ## Filing is not verifying, and the copy says so
 *
 * The server writes `pending` and clears every review field whoever called it,
 * so a clerk who uploads a licence has **not** accepted it. ADR-0033 §4's
 * "nothing is auto-verified, ever" applies to the office as much as to a
 * machine, and the confirmation names that rather than leaving somebody to
 * assume the row is now done.
 *
 * ## The expiry is asked for when the type needs it
 *
 * Driven by the server's own `requires_expiry`, never by a copy of the rule in
 * this bundle — which is how a console ends up asserting a rule the office has
 * since changed. Asked *before* the upload, so nobody learns about it as a 422
 * on a file they have already chosen.
 */
function UploadDocumentDialog({
  driverId,
  slot,
  onCancel,
  onFiled,
}: {
  driverId: number
  slot: DriverDocumentSlot
  onCancel: () => void
  onFiled: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const missingExpiry = slot.requires_expiry && expiresAt === ''

  const submit = async () => {
    if (file === null || missingExpiry) return

    setBusy(true)
    setProblem(null)

    const form = new FormData()

    form.append('type', slot.type)
    form.append('file', file)

    if (expiresAt !== '') form.append('expires_at', expiresAt)

    try {
      await apiClient.post(`/drivers/${driverId}/documents`, form)
      onFiled()
    } catch (failure) {
      setProblem(apiError(failure, 'That file could not be filed.').message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={`File ${slot.type_label.toLowerCase()}`}
      description="This does not verify it. Somebody still has to check it."
      onClose={onCancel}
      width={520}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {/*
            Disabled until there is something to send. The two conditions are
            the two the server refuses on, so the button cannot produce a 422
            the clerk has to read and translate.
          */}
          <Button onClick={() => void submit()} disabled={busy || file === null || missingExpiry}>
            {busy ? 'Filing…' : 'File document'}
          </Button>
        </div>
      }
    >
      {problem !== null && (
        <Alert tone="error" title="Upload" onDismiss={() => setProblem(null)}>
          {problem}
        </Alert>
      )}

      {slot.document !== null && (
        /*
          Replacing resets the review (ADR-0033 §2). Said here, where it can
          still change the decision, rather than after the fact.
        */
        <Alert tone="warning" title="This replaces what is on file">
          The current {slot.type_label.toLowerCase()} is discarded and the new one starts as
          unchecked.
        </Alert>
      )}

      {/*
        `htmlFor`/`id` spelled explicitly, the convention `RejectDialog` below
        uses: `FormField` annotates its child for `aria-describedby` but does
        not invent an id, so a label with neither points at nothing and the
        control has no accessible name at all.
      */}
      <FormField label="File" htmlFor="file-upload" hint="A photo or a PDF, up to 8 MB.">
        <Input
          id="file-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
      </FormField>

      {slot.requires_expiry && (
        <FormField
          label="Expires on"
          htmlFor="file-expires-at"
          required
          hint="This document's whole meaning is its date."
        >
          <Input
            id="file-expires-at"
            type="date"
            value={expiresAt}
            // A document cannot expire in the past and still be worth filing;
            // the server refuses it, and a control that cannot ask the
            // question beats a validation error.
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setExpiresAt(event.currentTarget.value)}
          />
        </FormField>
      )}
    </Dialog>
  )
}

/**
 * Turning a document down, with the reason the server requires.
 *
 * A separate dialog rather than an inline field, because a rejection is the
 * decision on this screen that a driver reads — it lands on their phone as the
 * only explanation they get — and it deserves the pause.
 */
function RejectDialog({
  document: doc,
  busy,
  onCancel,
  onConfirm,
}: {
  document: DriverDocument
  busy: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Dialog
      open
      title={`Reject this ${doc.type_label.toLowerCase()}?`}
      description="The driver sees only this reason."
      onClose={onCancel}
      width={480}
      tone="destructive"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason)}
            // The server refuses an empty reason; disabling here means the
            // reviewer learns that from the control rather than from a 422.
            disabled={busy || reason.trim().length < 3}
          >
            {busy ? 'Rejecting…' : 'Reject'}
          </Button>
        </>
      }
    >
      <FormField label="Reason" htmlFor="reject-reason" required>
        <Input
          id="reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Too dark to read the chassis number"
          maxLength={255}
          required
        />
      </FormField>
    </Dialog>
  )
}
