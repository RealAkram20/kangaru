import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { formatTimestamp } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { SupportRequest, SupportRequestStatus, SupportRequestTopic } from '../types/supportRequest'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Dialog } from '../components/feedback/Dialog'
import { FormField } from '../components/forms/FormField'
import { Select } from '../components/forms/Select'
import { Textarea } from '../components/forms/Textarea'
import { PageFill } from '../components/layout/PageFill'

/**
 * The queue ADR-0044 created — and the half that decides whether any of it was
 * worth building.
 *
 * The ADR's own consequence section puts it plainly: the office *gains an
 * obligation*. A driver writing an account of a passenger who refused to pay,
 * into a queue nobody opens, is the failure the whole feature exists to end —
 * the same failure ADR-0027 records for applications, one population over.
 *
 * **Unanswered, oldest first.** Every other list in this console is newest
 * first; this one is not, and the inversion is deliberate: the driver who has
 * waited longest has most earned a reply, and a newest-first queue starves
 * exactly the person it matters most to.
 *
 * **There is no "close" button anywhere on this page**, because there is no
 * such endpoint (ADR-0044 §2). A report leaves the queue when somebody has
 * written to the driver, and by no other route. A spam report costs one line;
 * that is cheaper than a queue drivers learn to distrust.
 */
const STATUS_TONE: Record<SupportRequestStatus, 'warning' | 'success'> = {
  open: 'warning',
  answered: 'success',
}

type StatusFilter = SupportRequestStatus | 'all'
type TopicFilter = SupportRequestTopic | 'all'

export function SupportRequestsPage() {
  const [reports, setReports] = useState<SupportRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [topic, setTopic] = useState<TopicFilter>('all')
  const [answering, setAnswering] = useState<SupportRequest | null>(null)

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<SupportRequest[]>>('/support-requests', {
          params: {
            ...(status === 'all' ? {} : { status }),
            ...(topic === 'all' ? {} : { topic }),
          },
        })
        .then((response) => {
          setReports(response.data.data)
          setError(null)
        })
        .catch(() => setError('Could not load driver reports.')),
    [status, topic],
  )

  // `.then()` rather than await-in-effect, as `DriversPage` explains: the
  // promise chain defers the state write to a microtask, which is what the
  // React Compiler's set-state-in-effect rule asks for.
  useEffect(() => {
    void load()
  }, [load])

  const openCount = useMemo(
    () => reports?.filter((report) => report.status === 'open').length ?? 0,
    [reports],
  )

  const columns: DataColumn<SupportRequest>[] = useMemo(
    () => [
      {
        key: 'driver_name',
        card: 'title',
        header: 'Driver',
        sortable: true,
        // A driver with no name on the row would make this a queue of
        // anonymous complaints; the API serves it for exactly that reason.
        render: (row) => row.driver_name ?? `Driver #${row.driver_id}`,
      },
      {
        key: 'topic_label',
        card: 'meta',
        header: 'About',
        sortable: true,
      },
      {
        key: 'body',
        card: 'meta',
        header: 'What they said',
        /*
          Clipped **here and only here**. The full account is in the dialog,
          unabridged — a table cell cannot hold three paragraphs, but a person
          deciding what to answer must never be shown a shortened version of
          somebody's account of an event.
        */
        render: (row) => (
          <span
            style={{
              display: 'block',
              maxWidth: 420,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={row.body}
          >
            {row.body}
          </span>
        ),
      },
      {
        key: 'created_at',
        card: 'meta',
        header: 'Sent',
        sortable: true,
        render: (row) => formatTimestamp(row.created_at),
      },
      {
        key: 'status',
        card: 'status',
        header: 'Status',
        render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status_label}</Badge>,
      },
      {
        key: 'id',
        card: 'meta',
        header: '',
        render: (row) =>
          row.status === 'open' ? (
            <Button size="sm" onClick={() => setAnswering(row)}>
              Answer
            </Button>
          ) : (
            // An answered report keeps its answer reachable rather than
            // offering a control that would 409 — the same call
            // `DriverApplicationsPage` makes about a decided application.
            <Button size="sm" variant="ghost" onClick={() => setAnswering(row)}>
              Read
            </Button>
          ),
      },
    ],
    [],
  )

  return (
    <PageFill>
      <PageFill.Flex>
      <Card
        fill
        title="Driver reports"
        subtitle={
          reports === null
            ? undefined
            : status === 'open'
              ? `${openCount} waiting for an answer`
              : `${reports.length} shown`
        }
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Select
              value={topic}
              onChange={(e) => setTopic(e.target.value as TopicFilter)}
              options={[
                { value: 'all', label: 'Every topic' },
                { value: 'report', label: 'Report an issue' },
                { value: 'passenger', label: 'Passenger issue' },
                { value: 'vehicle', label: 'Vehicle issue' },
                { value: 'payment', label: 'Payment issue' },
                { value: 'lost_item', label: 'Lost item' },
              ]}
              style={{ width: 190 }}
            />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              options={[
                { value: 'open', label: 'Waiting for an answer' },
                { value: 'answered', label: 'Answered' },
                { value: 'all', label: 'All' },
              ]}
              style={{ width: 200 }}
            />
          </div>
        }
        padding="none"
      >
        {error ? (
          <p style={{ padding: 'var(--space-6)', color: 'var(--kr-error)' }}>{error}</p>
        ) : (
          <DataTable<SupportRequest>
            columns={columns}
            rows={reports ?? []}
            fill
            emptyMessage={
              reports === null
                ? 'Loading…'
                : status === 'open'
                  ? 'Nothing waiting — every driver report has an answer.'
                  : 'No reports with those filters'
            }
          />
        )}
      </Card>
      </PageFill.Flex>

      {answering && (
        <AnswerDialog
          report={answering}
          onClose={() => setAnswering(null)}
          onAnswered={async () => {
            await load()
            setAnswering(null)
          }}
        />
      )}
    </PageFill>
  )
}

/**
 * Reading a report in full, and writing back.
 *
 * The driver's account comes first and whole. The reply box sits under it
 * rather than beside it, so nobody answers a report they have scrolled past.
 */
function AnswerDialog({
  report,
  onClose,
  onAnswered,
}: {
  report: SupportRequest
  onClose: () => void
  onAnswered: () => Promise<void>
}) {
  const [answer, setAnswer] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const alreadyAnswered = report.answer !== null

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setMessage(null)

    try {
      await apiClient.post(`/support-requests/${report.id}/answer`, { answer })
      await onAnswered()
    } catch (failure) {
      const problem = apiError(failure, 'Could not send your answer.')

      setErrors(fieldErrors(problem))
      setMessage(Object.keys(fieldErrors(problem)).length === 0 ? problem.message : null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      title={`${report.driver_name ?? `Driver #${report.driver_id}`} — ${report.topic_label}`}
      description={
        alreadyAnswered
          ? 'This one has been answered. The driver has already been told; answering again would not reach them.'
          : 'What you write is sent to the driver as a notification and appears in their app. Nothing else about this report reaches them, so say what they need to know.'
      }
      onClose={onClose}
      width={640}
      footer={
        alreadyAnswered ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting || answer.trim().length < 5}>
              {submitting ? 'Sending…' : 'Send answer'}
            </Button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', margin: 0 }}>
            Sent {formatTimestamp(report.created_at)}
            {report.trip_id === null ? '' : ` · about trip #${report.trip_id}`}
          </p>

          {/*
            `pre-wrap`, so the driver's own paragraph breaks survive. Collapsing
            them would run an account of several separate events into one
            block — and this is the text a decision is made from.
          */}
          <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--space-2) 0 0' }}>{report.body}</p>
        </div>

        {alreadyAnswered ? (
          <div>
            <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', margin: 0 }}>
              Answered by {report.answered_by ?? 'the office'}
              {report.answered_at === null ? '' : ` · ${formatTimestamp(report.answered_at)}`}
            </p>
            <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--space-2) 0 0' }}>{report.answer}</p>
          </div>
        ) : (
          <FormField label="Your answer" error={errors.answer} htmlFor="support-answer">
            <Textarea
              id="support-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={6}
              placeholder="What should this driver be told?"
              invalid={errors.answer !== undefined}
              disabled={submitting}
            />
          </FormField>
        )}

        {message && <p style={{ color: 'var(--kr-error)', margin: 0 }}>{message}</p>}
      </div>
    </Dialog>
  )
}
