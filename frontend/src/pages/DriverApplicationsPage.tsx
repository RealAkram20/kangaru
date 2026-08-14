import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { formatTimestamp } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { DriverApplication } from '../types/driverApplication'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'
import { Textarea } from '../components/forms/Textarea'

/**
 * The inbox ADR-0027 created.
 *
 * Its consequences section says it plainly: "somebody has to read it — an
 * application nobody reviews is worse than no form, because the applicant
 * believes they have applied." This is the screen that makes reading it
 * possible, and it opens on the pending queue for that reason.
 *
 * Oldest first, matching the server's ordering: a rider who applied on
 * Monday should not sink under Friday's arrivals.
 */
const STATUS_TONE: Record<DriverApplication['status'], 'warning' | 'success' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'neutral',
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all'

export function DriverApplicationsPage() {
  const [applications, setApplications] = useState<DriverApplication[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [deciding, setDeciding] = useState<DriverApplication | null>(null)

  const load = useCallback(
    () =>
      apiClient
        .get<
          ApiSuccess<{ driver_applications: DriverApplication[] }>
        >('/driver-applications', { params: status === 'all' ? {} : { status } })
        .then((response) => {
          setApplications(response.data.data.driver_applications)
          setError(null)
        })
        .catch(() => setError('Could not load driver applications.')),
    [status],
  )

  // `.then()` rather than await-in-effect, as DriversPage explains: the
  // promise chain defers the state write to a microtask, which is what the
  // React Compiler's set-state-in-effect rule is asking for.
  useEffect(() => {
    void load()
  }, [load])

  const pendingCount = useMemo(
    () => applications?.filter((a) => a.status === 'pending').length ?? 0,
    [applications],
  )

  const columns: DataColumn<DriverApplication>[] = useMemo(
    () => [
      { key: 'name', header: 'Name', sortable: true },
      // The number the office actually rings: ADR-0027 §6 gives an applicant
      // no way to check their own status, so this is how they hear anything.
      { key: 'phone', header: 'Phone' },
      { key: 'email', header: 'Email' },
      {
        key: 'created_at',
        header: 'Applied',
        sortable: true,
        // The raw ISO string is what the API sends and is unreadable in a
        // table; every other timestamped screen here uses this helper.
        render: (row) => formatTimestamp(row.created_at),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status_label}</Badge>,
      },
      {
        key: 'id',
        header: '',
        render: (row) =>
          row.status === 'pending' ? (
            <Button size="sm" onClick={() => setDeciding(row)}>
              Review
            </Button>
          ) : (
            // Decided rows keep their reason visible rather than offering a
            // control that would 409: ADR-0027 §4 makes a decision final.
            <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
              {row.rejection_reason ?? (row.driver_id !== null ? `Driver #${row.driver_id}` : '—')}
            </span>
          ),
      },
    ],
    [],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
        title="Driver applications"
        subtitle={
          applications === null
            ? undefined
            : status === 'pending'
              ? `${pendingCount} awaiting review`
              : `${applications.length} shown`
        }
        actions={
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            options={[
              { value: 'pending', label: 'Awaiting review' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ]}
            style={{ width: 200 }}
          />
        }
        padding="none"
      >
        {error ? (
          <p style={{ padding: 'var(--space-6)', color: 'var(--kr-error)' }}>{error}</p>
        ) : (
          <DataTable<DriverApplication>
            columns={columns}
            rows={applications ?? []}
            emptyMessage={
              applications === null
                ? 'Loading…'
                : status === 'pending'
                  ? 'Nothing awaiting review — the queue is empty.'
                  : 'No applications with that status'
            }
          />
        )}
      </Card>

      {deciding && (
        <DecisionDialog
          application={deciding}
          onClose={() => setDeciding(null)}
          onDecided={async () => {
            await load()
            setDeciding(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Approve or reject, in one dialog.
 *
 * Approving asks for the two things the applicant could not be trusted to
 * supply — a licence number and its expiry, read off the document in the
 * reviewer's hand (ADR-0027 §4). The applicant's own name, phone and email
 * are shown but not editable here: correcting them is a driver-profile edit
 * afterwards, not a quiet rewrite of what somebody submitted.
 */
function DecisionDialog({
  application,
  onClose,
  onDecided,
}: {
  application: DriverApplication
  onClose: () => void
  onDecided: () => Promise<void>
}) {
  const [mode, setMode] = useState<'approve' | 'reject'>('approve')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [licenseExpiry, setLicenseExpiry] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setSubmitting(true)
    setErrors({})
    setMessage(null)

    try {
      await action()
      await onDecided()
    } catch (failure) {
      const problem = apiError(failure, fallback)
      setErrors(fieldErrors(problem))
      // A 409 (somebody else already decided this, or the email is taken)
      // has no field to hang off, so it shows as the dialog's message.
      setMessage(Object.keys(fieldErrors(problem)).length === 0 ? problem.message : null)
    } finally {
      setSubmitting(false)
    }
  }

  const approve = () =>
    run(
      () =>
        apiClient.post(`/driver-applications/${application.id}/approve`, {
          license_number: licenseNumber,
          license_expiry: licenseExpiry,
        }),
      'Could not approve this application.',
    )

  const reject = () =>
    run(
      () => apiClient.post(`/driver-applications/${application.id}/reject`, { reason }),
      'Could not reject this application.',
    )

  return (
    <Dialog
      open
      title={`${application.name}'s application`}
      description={
        mode === 'approve'
          ? 'Approving creates their driver profile and their sign-in together. They use the password they chose when they applied — nobody needs to tell them one.'
          : 'The reason is recorded for the office. Nothing is sent to the applicant automatically; call them on the number below if they should know.'
      }
      onClose={onClose}
      width={620}
      tone={mode === 'reject' ? 'destructive' : 'default'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {mode === 'approve' ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setMode('reject')}
                disabled={submitting}
              >
                Reject instead
              </Button>
              <Button onClick={() => void approve()} disabled={submitting}>
                {submitting ? 'Approving…' : 'Approve and create sign-in'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => setMode('approve')}
                disabled={submitting}
              >
                Back to approve
              </Button>
              <Button variant="destructive" onClick={() => void reject()} disabled={submitting}>
                {submitting ? 'Rejecting…' : 'Reject application'}
              </Button>
            </>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {message !== null && (
          <Alert tone="error" title="Application" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 'var(--space-2) var(--space-4)',
            margin: 0,
            font: 'var(--type-body-dense)',
          }}
        >
          <dt style={{ color: 'var(--text-secondary)' }}>Phone</dt>
          <dd style={{ margin: 0 }}>{application.phone}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Email</dt>
          <dd style={{ margin: 0 }}>{application.email}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Applied</dt>
          <dd style={{ margin: 0 }}>{formatTimestamp(application.created_at)}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Terms accepted</dt>
          <dd style={{ margin: 0 }}>{formatTimestamp(application.terms_accepted_at)}</dd>
        </dl>

        {mode === 'approve' ? (
          <>
            <FormField
              label="Licence number"
              htmlFor="application-license-number"
              hint="From the licence you checked, not from the applicant's form — this is the field the fleet screen treats as verified, and it is unique platform-wide."
              error={errors.license_number}
              required
            >
              <Input
                id="application-license-number"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                required
              />
            </FormField>

            <FormField
              label="Licence expiry"
              htmlFor="application-license-expiry"
              hint="Must be in the future — onboarding somebody on an expired licence is the one thing this field exists to prevent."
              error={errors.license_expiry}
              required
            >
              <Input
                id="application-license-expiry"
                type="date"
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
                required
                style={{ maxWidth: 220 }}
              />
            </FormField>
          </>
        ) : (
          <FormField
            label="Reason"
            htmlFor="application-reject-reason"
            hint="For the office. It lets whoever reads this in three months tell a lapsed licence apart from a decision worth revisiting."
            error={errors.reason}
            required
          >
            <Textarea
              id="application-reject-reason"
              rows={4}
              value={reason}
              invalid={errors.reason !== undefined}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        )}
      </div>
    </Dialog>
  )
}
