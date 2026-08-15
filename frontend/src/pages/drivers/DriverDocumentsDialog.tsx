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

  return (
    <Dialog
      open
      title={`${driver.name}’s documents`}
      description="Open each file, check it against the driver's record, and decide. Nothing here is verified automatically."
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
              driverId={driver.id}
              slot={slot}
              busy={busy === slot.document?.id}
              onVerify={() => slot.document && void review(slot.document, 'verify')}
              onReject={() => slot.document && setRejecting(slot.document)}
            />
          ))}
        </div>
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
  driverId,
  slot,
  busy,
  onVerify,
  onReject,
}: {
  driverId: number
  slot: DriverDocumentSlot
  busy: boolean
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

      {document !== null && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
          <DocumentFileButton driverId={driverId} document={document} />
          <Button size="sm" onClick={onVerify} disabled={busy}>
            Verify
          </Button>
          <Button size="sm" variant="destructive" onClick={onReject} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Opens the file in a new tab.
 *
 * **Fetched with the session's bearer and opened as a blob**, never linked
 * directly: the endpoint is authenticated, so a plain `<a href>` would send no
 * token and produce a 401 page where somebody's identity document should be.
 * That is also the point of ADR-0033 §5 — the file is behind the API precisely
 * so that a URL alone is not enough.
 *
 * The object URL is revoked on a timer rather than immediately: revoking
 * before the new tab has read it produces a blank window, and a browser that
 * blocked the popup would otherwise leak the handle for the life of the page.
 */
function DocumentFileButton({
  driverId,
  document: doc,
}: {
  driverId: number
  document: DriverDocument
}) {
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)

    try {
      const response = await apiClient.get<Blob>(
        `/drivers/${driverId}/documents/${doc.id}/file`,
        { responseType: 'blob' },
      )

      const url = URL.createObjectURL(response.data)

      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={() => void open()} disabled={busy}>
      {busy ? 'Opening…' : 'Open'}
    </Button>
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
      description="The driver sees this reason and nothing else, so say what would make the next attempt right."
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
