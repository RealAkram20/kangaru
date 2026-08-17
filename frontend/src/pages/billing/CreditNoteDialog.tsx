import { useMemo, useState } from 'react'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { newIdempotencyKey } from '../../lib/billing'
import { formatUgx } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type { CreditNote, Invoice } from '../../types/billing'

/**
 * Issues a credit note — the only way this platform changes what a client
 * owes (AGENTS.md: corrections are credit notes, "never silent edits to
 * issued invoices").
 *
 * The remaining-balance guard here is a courtesy that catches the mistake
 * before a round trip. The real invariant lives in CreditNoteService, which
 * checks the running total across *every* credit note under the invoice's
 * row lock — this dialog cannot see a note a colleague is issuing right
 * now, so a 422 CREDIT_NOTE_EXCEEDS_INVOICE is still possible and is
 * surfaced rather than swallowed.
 */
export function CreditNoteDialog({
  invoice,
  onClose,
  onIssued,
}: {
  invoice: Invoice
  onClose: () => void
  onIssued: (note: CreditNote) => void
}) {
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [invoiceLineId, setInvoiceLineId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Minted once for this dialog and reused on every retry: the same key
  // means "this is the request I already sent". A new key per click would
  // turn a retry after a timeout into a second credit.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [])

  const value = Number(amount)
  const overBalance = amount !== '' && Number.isFinite(value) && value > invoice.balance_minor
  const incomplete =
    reason.trim().length < 3 || description.trim() === '' || amount === '' || !Number.isFinite(value) || value < 1

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setFailure(null)

    try {
      const response = await apiClient.post<ApiSuccess<CreditNote>>(
        `/invoices/${invoice.uuid}/credit-notes`,
        {
          reason: reason.trim(),
          lines: [
            {
              description: description.trim(),
              amount_minor: value,
              ...(invoiceLineId === '' ? {} : { invoice_line_id: Number(invoiceLineId) }),
            },
          ],
        },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      )

      onIssued(response.data.data)
    } catch (error) {
      const problem = apiError(error, 'Could not issue this credit note.')
      setErrors(fieldErrors(problem))
      setFailure(problem.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      title={`Credit note against ${invoice.invoice_number}`}
      description={`Invoiced ${formatUgx(invoice.total_minor)}, ${formatUgx(invoice.balance_minor)} outstanding.`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Back
          </Button>
          <Button loading={submitting} disabled={incomplete || overBalance} onClick={() => void submit()}>
            Issue credit note
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {failure && Object.keys(errors).length === 0 && (
          <Alert tone="error" title="Not issued">
            {failure}
          </Alert>
        )}

        <Alert tone="info" title="A credit note is permanent">
          It cannot be edited or withdrawn afterwards. A note issued in error stays on the record, and the
          record shows both — which is the property an auditor is checking for.
        </Alert>

        <FormField
          label="Reason"
          htmlFor="cn-reason"
          required
          hint="A credit with no stated reason is an audit finding."
          error={errors.reason}
        >
          <Input
            id="cn-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Client disputed the waiting charge; agreed to reduce."
            autoFocus
          />
        </FormField>

        <FormField label="What is being credited" htmlFor="cn-description" required error={errors['lines.0.description']}>
          <Input
            id="cn-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Waiting time correction"
          />
        </FormField>

        <FormField
          label="Amount"
          htmlFor="cn-amount"
          required
          // UGX is zero-decimal, so the figure typed is the figure stored —
          // there is no minor-unit conversion to get wrong.
          hint={`Whole shillings. At most ${formatUgx(invoice.balance_minor)} can still be credited.`}
          error={errors['lines.0.amount_minor']}
        >
          <Input
            id="cn-amount"
            type="number"
            min={1}
            step={1}
            mono
            suffix="UGX"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            invalid={overBalance}
          />
        </FormField>

        {overBalance && (
          <Alert tone="warning" title="More than the invoice has left">
            {formatUgx(invoice.total_minor)} was invoiced and {formatUgx(invoice.credited_minor)} already
            credited, so at most {formatUgx(invoice.balance_minor)} remains.
          </Alert>
        )}

        <FormField
          label="Against a specific line"
          htmlFor="cn-line"
          hint="Optional. Leave blank for a goodwill or settlement credit that corrects no single line."
          error={errors['lines.0.invoice_line_id']}
        >
          <Select
            id="cn-line"
            placeholder="No specific line"
            value={invoiceLineId}
            onChange={(e) => setInvoiceLineId(e.target.value)}
            options={(invoice.lines ?? []).map((line) => ({
              // The line's own id, not its line_number: the server
              // validates this against `invoice_lines.id`, scoped to this
              // invoice and this tenant.
              value: String(line.id),
              label: `${line.type_label} — ${formatUgx(line.amount_minor)}`,
            }))}
          />
        </FormField>
      </div>
    </Dialog>
  )
}
