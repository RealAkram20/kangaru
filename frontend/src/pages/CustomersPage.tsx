import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'
import type { CustomerProfile, CustomerTally } from '../types/customer'
import type { OrderRequest } from '../types/orderRequest'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { EmptyState } from '../components/feedback/EmptyState'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'

/**
 * The customer register (ADR-0018) — Shanitah's own retail account holders.
 *
 * Deliberately not "Clients": `Companies` already means the corporate
 * clients, and one word for two different populations is how a support
 * agent ends up looking in the wrong list.
 *
 * Everything here is read-only except suspension. There is no password
 * reset and no profile edit, and their absence is the design: an
 * administrator silently changing a member of the public's credentials is
 * the one act an audit trail cannot tell apart from impersonation — the
 * same line `Modules/Administration` draws for staff.
 */
interface Register {
  customers: CustomerProfile[]
  tally: CustomerTally
}

async function fetchRegister(query: string, status: string): Promise<Register> {
  const params = new URLSearchParams()
  // Two characters minimum, matching the server: a single letter matches
  // most of the register and costs a full scan to say so.
  if (query.trim().length >= 2) params.set('q', query.trim())
  if (status !== '') params.set('status', status)

  const response = await apiClient.get<ApiSuccess<CustomerProfile[]>>(
    `/customers${params.size > 0 ? `?${params}` : ''}`,
  )

  return {
    customers: response.data.data,
    tally: (response.data.meta as { tally: CustomerTally } | undefined)?.tally ?? {
      total: 0,
      active: 0,
      suspended: 0,
    },
  }
}

export function CustomersPage() {
  const [register, setRegister] = useState<Register | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState<CustomerProfile | null>(null)

  const load = useCallback(
    () =>
      fetchRegister(query, status)
        .then((next) => {
          setRegister(next)
          setError(null)
        })
        .catch((failure: unknown) =>
          setError(apiError(failure, 'Could not load the customer register.').message),
        ),
    [query, status],
  )

  /**
   * Searching hits the server rather than filtering what is loaded.
   *
   * The register is cursor-paginated, so a client-side filter would sift
   * only the first 25 rows — and a dispatcher who cannot find a caller
   * concludes the customer is not registered, which is worse than a slow
   * search. Debounced so it is one request per pause, not per keystroke.
   */
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250)

    return () => clearTimeout(timer)
  }, [load])

  const columns: DataColumn<CustomerProfile>[] = useMemo(
    () => [
      { key: 'name', header: 'Name', sortable: true },
      { key: 'phone', header: 'Phone' },
      { key: 'email', header: 'Email', render: (row) => row.email ?? '—' },
      {
        key: 'status',
        header: 'Status',
        render: (row) =>
          row.status === 'active' ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="warning" icon="ban">
              Suspended
            </Badge>
          ),
      },
      {
        key: 'id',
        header: '',
        render: (row) => (
          <Button size="sm" variant="secondary" onClick={() => setOpen(row)}>
            Open
          </Button>
        ),
      },
    ],
    [],
  )

  const tally = register?.tally

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Customer register unavailable">
          {error}
        </Alert>
      )}

      <Card
        title="Customers"
        subtitle={
          tally
            ? `${tally.total} registered · ${tally.active} active · ${tally.suspended} suspended`
            : undefined
        }
        padding="none"
        actions={
          <>
            <Input
              iconLeft="search"
              placeholder="Name, phone or email"
              aria-label="Search customers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 260 }}
            />
            <Select
              aria-label="Status"
              size="sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
              ]}
              style={{ width: 160 }}
            />
          </>
        }
      >
        <DataTable<CustomerProfile>
          columns={columns}
          rows={register?.customers ?? []}
          emptyMessage={
            register === null
              ? 'Loading…'
              : query
                ? 'Nobody matches that search'
                : 'No customers have registered yet'
          }
        />
      </Card>

      {open && (
        <CustomerDrawer
          customer={open}
          onClose={() => setOpen(null)}
          onChanged={async () => {
            await load()
            setOpen(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * One customer: who they are, how they sign in, and what they have asked
 * for. The activity loads with the drawer rather than with the list —
 * pulling a year of orders to render a phone number is the N+1 of screens.
 */
function CustomerDrawer({
  customer,
  onClose,
  onChanged,
}: {
  customer: CustomerProfile
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [activity, setActivity] = useState<OrderRequest[] | null>(null)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<OrderRequest[]>>(`/customers/${customer.id}/activity`)
      .then((response) => {
        if (!cancelled) setActivity(response.data.data)
      })
      .catch(() => {
        // Not fatal: the profile is still worth showing to somebody with a
        // caller waiting, and an error banner over a panel that otherwise
        // works is noise.
        if (!cancelled) setActivity([])
      })

    return () => {
      cancelled = true
    }
  }, [customer.id])

  const act = async (run: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setErrors({})
    setMessage(null)

    try {
      await run()
      await onChanged()
    } catch (failure) {
      const problem = apiError(failure, fallback)
      setErrors(fieldErrors(problem))
      setMessage(problem.message)
    } finally {
      setBusy(false)
    }
  }

  const suspended = customer.status === 'suspended'

  return (
    <Dialog
      open
      title={customer.name}
      description={suspended ? 'This account cannot be used until it is restored.' : undefined}
      onClose={onClose}
      width={640}
      tone={suspended ? 'warning' : 'default'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {suspended ? (
            <Button
              onClick={() =>
                void act(
                  () => apiClient.delete(`/customers/${customer.id}/suspension`),
                  'Could not restore this account.',
                )
              }
              disabled={busy}
            >
              {busy ? 'Restoring…' : 'Restore account'}
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() =>
                void act(
                  () => apiClient.post(`/customers/${customer.id}/suspension`, { reason }),
                  'Could not suspend this account.',
                )
              }
              disabled={busy}
            >
              {busy ? 'Suspending…' : 'Suspend account'}
            </Button>
          )}
        </>
      }
    >
      {message && Object.keys(errors).length === 0 && (
        <Alert tone="error" title="Customer" onDismiss={() => setMessage(null)}>
          {message}
        </Alert>
      )}

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 'var(--space-2) var(--space-4)',
          margin: 0,
        }}
      >
        <dt style={{ color: 'var(--text-secondary)' }}>Phone</dt>
        <dd style={{ margin: 0 }}>{customer.phone}</dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Email</dt>
        <dd style={{ margin: 0 }}>{customer.email ?? '—'}</dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Signs in with</dt>
        <dd style={{ margin: 0 }}>
          {/* The first question on "I cannot log in" (ADR-0013 §3). */}
          {[customer.has_password && 'a password', customer.has_google && 'Google']
            .filter(Boolean)
            .join(' and ') || 'no credential yet'}
        </dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Orders</dt>
        <dd style={{ margin: 0 }}>{customer.orders_count ?? activity?.length ?? '—'}</dd>
      </dl>

      {suspended && customer.suspension_reason && (
        <Alert tone="warning" title="Suspended" style={{ marginTop: 'var(--space-4)' }}>
          {customer.suspension_reason}
        </Alert>
      )}

      {!suspended && (
        <FormField
          label="Reason for suspending"
          htmlFor="customer-suspend-reason"
          hint="The customer will ask, so write what somebody could read back to them."
          error={errors.reason}
          style={{ marginTop: 'var(--space-4)' }}
        >
          <Input
            id="customer-suspend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Chargebacks on four consecutive rides"
          />
        </FormField>
      )}

      <div style={{ marginTop: 'var(--space-6)' }}>
        <p
          style={{
            font: 'var(--type-overline)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-caps)',
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Recent orders
        </p>

        {activity === null ? (
          <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
        ) : activity.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="Nothing yet"
            description="This customer has not ordered."
          />
        ) : (
          <ul
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: 0 }}
          >
            {activity.slice(0, 8).map((order) => (
              <li
                key={order.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--space-4)',
                  font: 'var(--type-body-dense)',
                }}
              >
                <span>
                  {order.pickup_location} → {order.dropoff_location}
                </span>
                <Badge tone="neutral">{order.status.replace(/_/g, ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
