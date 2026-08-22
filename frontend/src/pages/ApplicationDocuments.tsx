import { useEffect, useState, type ComponentProps } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'
import type { DriverDocument, DriverDocumentSlot } from '../types/driverDocument'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Alert } from '../components/feedback/Alert'
import { MediaPreview } from '../components/media/MediaPreview'
import { RejectDialog } from './drivers/DriverDocumentsDialog'

/**
 * What the applicant sent, inside the dialog where they are approved or
 * rejected.
 *
 * ## Why it lives in the decision dialog and not behind its own button
 *
 * Until this existed, the queue offered Approve and Reject over a name, a
 * phone number and a status. The papers were reaching the server — ADR-0048
 * §4's upload has worked since the applicant's claim ticket was minted — and
 * nothing in the platform could read them back. **The decision on that dialog
 * is whether somebody may drive, and it was being taken without their licence
 * ever being visible.** Putting the documents anywhere else keeps a click
 * between the reviewer and the only evidence there is.
 *
 * ## Read-only, deliberately
 *
 * No verify, no reject, no upload — the three things `DriverDocumentsDialog`
 * offers for a driver. Per-document verdicts belong to ADR-0033 §4 and start
 * once a driver exists; before that the only decision is the application
 * itself, and the dialog around this component owns it. A second, quieter way
 * to refuse somebody, with no audit trail on the application, is not a
 * feature.
 *
 * ## The duplication here, named rather than hidden
 *
 * The row below is a read-only cousin of `DocumentRow` in
 * `DriverDocumentsDialog`. Extracting one shared row is the right end state
 * and is **not** done here: that file is another surface's, it is four
 * hundred lines, and this tree has several agents in it tonight. Recorded in
 * `docs/agent-worklog.md` so the third caller extracts it rather than adding
 * a third copy.
 */

/** Matches `DriverDocumentsDialog`, so one status reads the same on both. */
const TONE: Record<string, ComponentProps<typeof Badge>['tone']> = {
  verified: 'success',
  pending: 'warning',
  rejected: 'error',
  expired: 'error',
  missing: 'neutral',
}

export function ApplicationDocuments({
  applicationId,
  onReviewed,
}: {
  applicationId: number
  /**
   * A verdict was recorded. The dialog above refetches the application, so
   * approval stops being refused the moment the last document is accepted.
   */
  onReviewed?: () => void
}) {
  const [slots, setSlots] = useState<DriverDocumentSlot[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [previewAt, setPreviewAt] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [refusing, setRefusing] = useState<DriverDocument | null>(null)
  const [reloadAt, setReloadAt] = useState(0)

  /*
    Fetched when the dialog opens, never with the queue. The list at
    `/driver-applications` can be dozens of rows and a reviewer opens one of
    them; loading every applicant's documents to render a table nobody has
    asked to expand is the wasted request this platform's cost discipline is
    about.
  */
  useEffect(() => {
    let live = true

    apiClient
      .get<ApiSuccess<DriverDocumentSlot[]>>(`/driver-applications/${applicationId}/documents`)
      .then((response) => {
        if (!live) {
          return
        }

        /*
          Checked at the boundary rather than defended against further down.

          This section is the *secondary* content of a dialog whose primary
          job is Approve and Reject. A payload that is not a list would throw
          during render and take the whole dialog with it — so a reviewer who
          could not see the documents would also lose the ability to decide
          at all, which is a far worse failure than the one that caused it.
          One check here keeps the blast radius to this section, and says so
          rather than rendering an empty list that looks like "nothing sent".
        */
        if (!Array.isArray(response.data.data)) {
          setMessage('The office could not read this applicant’s documents.')

          return
        }

        setSlots(response.data.data)
      })
      .catch((failure) => {
        if (live) {
          setMessage(apiError(failure, 'Could not load this applicant’s documents.').message)
        }
      })

    return () => {
      live = false
    }
    // `reloadAt` rather than a `load()` callback: the effect already owns the
    // `live` flag that stops a late response writing into an unmounted
    // section, and a second fetch path would need its own copy of it.
  }, [applicationId, reloadAt])

  /**
   * Records one verdict.
   *
   * Both verbs go through here so the busy state, the error surface and the
   * refetch cannot drift between them — the drift that lets Refuse leave a
   * spinner running when Accept does not.
   */
  const review = async (document: DriverDocument, verdict: 'verify' | 'reject', reason?: string) => {
    setBusy(document.id)
    setMessage(null)

    try {
      await apiClient.post(
        `/driver-applications/${applicationId}/documents/${document.id}/${verdict}`,
        verdict === 'reject' ? { reason } : {},
      )

      setRefusing(null)
      setReloadAt((tick) => tick + 1)
      onReviewed?.()
    } catch (failure) {
      setMessage(apiError(failure, 'Could not record that decision.').message)
    } finally {
      setBusy(null)
    }
  }

  /*
    Only the slots holding a file, in the order the server sent them. The
    previewer browses documents, not empty rows — an arrow that lands on
    "Not sent" is an arrow that wasted a click.
  */
  const held = (slots ?? []).filter((slot) => slot.document !== null)

  /*
    `?? null`, and not defensiveness for its own sake. Recording a verdict from
    inside the previewer refetches the slots, and an index that was valid
    against the old list can point past the end of the new one — a document
    withdrawn in another tab, or a list that came back shorter. Reading
    `undefined` here renders nothing and throws on the next property access,
    which would take the whole decision dialog down over a preview.
  */
  const previewing = previewAt === null ? null : (held[previewAt] ?? null)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3
        style={{
          margin: 0,
          font: 'var(--text-label)',
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Documents
      </h3>

      {message && (
        <Alert tone="error" title="Documents" onDismiss={() => setMessage(null)}>
          {message}
        </Alert>
      )}

      {slots === null && message === null && (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading…</p>
      )}

      {slots !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {slots.map((slot) => {
            /*
              `compliance_state`, never `status`. A licence past its date still
              carries `status: 'verified'` because nothing wrote to the row,
              and a screen reading `status` would tell this office that a
              lapsed licence is in order — on the screen where they decide
              whether to let somebody drive.
            */
            const state = slot.document?.compliance_state ?? 'missing'
            const position = held.findIndex((other) => other.type === slot.type)

            return (
              <div
                key={slot.type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)' }}>{slot.type_label}</div>
                  {slot.document?.expires_at != null && (
                    <div style={{ font: 'var(--text-caption)', color: 'var(--text-secondary)' }}>
                      Expires {slot.document.expires_at}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {/*
                    The badge carries a word, not only a colour — status is
                    never signalled by colour alone (screen-rules §6).
                  */}
                  <Badge tone={TONE[state] ?? 'neutral'}>
                    {slot.document === null
                      ? 'Not sent'
                      : state === 'expired'
                        ? 'Expired'
                        : slot.document.status_label}
                  </Badge>

                  {slot.document !== null && position >= 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => setPreviewAt(position)}
                      aria-label={`View ${slot.type_label}`}
                    >
                      View
                    </Button>
                  )}

                  {/*
                    Only on a document that has not been accepted. Offering
                    "Accept" on something already accepted invites a reviewer
                    to wonder whether the first one registered, and re-running
                    a verdict rewrites the reviewer and timestamp on the row
                    for no decision anybody made.
                  */}
                  {slot.document !== null && state !== 'verified' && (
                    <>
                      <Button
                        onClick={() => void review(slot.document as DriverDocument, 'verify')}
                        disabled={busy === slot.document.id}
                        aria-label={`Accept ${slot.type_label}`}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setRefusing(slot.document)}
                        disabled={busy === slot.document.id}
                        aria-label={`Refuse ${slot.type_label}`}
                      >
                        Refuse
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {previewing?.document != null && previewAt !== null && (
        <MediaPreview
          /*
            Keyed by the document, so moving to the next one remounts rather
            than mutating: zoom and pan reset to fit, which is what "show me
            the next paper" means.
          */
          key={previewing.document.id}
          source={{
            // Built here rather than taken from a `file_url`, for the reason
            // ADR-0033 §5 gives: the bytes are fetched with the session and
            // never addressed by a URL alone.
            url: `/driver-applications/${applicationId}/documents/${previewing.document.id}/file`,
            mimeType: previewing.document.mime_type,
            name: previewing.document.original_name,
            sizeBytes: previewing.document.size_bytes,
            title: previewing.type_label,
          }}
          browse={{
            position: previewAt + 1,
            total: held.length,
            // Null at the ends rather than wrapping, so a reviewer knows when
            // they have seen them all.
            onPrevious: previewAt > 0 ? () => setPreviewAt(previewAt - 1) : null,
            onNext: previewAt < held.length - 1 ? () => setPreviewAt(previewAt + 1) : null,
          }}
          /*
            The same two verdicts, without closing the document to reach them.

            Judging a document and acting on it are one moment: before this,
            deciding meant closing the preview, finding the row again and
            pressing a button — four steps after the decision was already
            made. With the browse arrows beside them, a reviewer works
            through all six without the previewer closing once.

            `previewing.document` rather than a captured row: the preview
            browses, so the document under these buttons changes while they
            stay mounted.

            **No `aria-label` here, unlike the row's pair.** The row needs one
            because six "Accept" buttons in a list are six identical
            announcements. Inside a dialog already titled "Driving licence"
            the type is the heading, and repeating it would give two controls
            the same accessible name while both are in the tree.
          */
          actions={
            previewing.document.compliance_state !== 'verified' ? (
              <>
                <Button
                  onClick={() => void review(previewing.document as DriverDocument, 'verify')}
                  disabled={busy === previewing.document.id}
                >
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setRefusing(previewing.document)}
                  disabled={busy === previewing.document.id}
                >
                  Refuse
                </Button>
              </>
            ) : undefined
          }
          onClose={() => setPreviewAt(null)}
        />
      )}

      {refusing !== null && (
        <RejectDialog
          document={refusing}
          busy={busy === refusing.id}
          /*
            Not the driver's wording. An applicant is emailed this reason with
            a fresh link to send a replacement (ADR-0057 §3), and a reviewer
            writing "too dark" needs to know it is going to be read by the
            person who has to fix it, not filed.
          */
          description="The applicant is emailed this reason, with a link to send another."
          onCancel={() => setRefusing(null)}
          onConfirm={(reason) => void review(refusing, 'reject', reason)}
        />
      )}
    </section>
  )
}
