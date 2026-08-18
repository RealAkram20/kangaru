import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
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
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { formatTimestamp } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { AssignableRole, StaffMeta, StaffUser } from '../types/staff'

/**
 * Staff administration.
 *
 * Until this page existed every account in the platform came from a
 * seeder — there was no way to onboard a colleague, change a role, or take
 * access away when somebody left.
 *
 * Two rules the server owns and this page only reflects: which roles may be
 * assigned (served as `meta.assignable_roles`, so a Corporate Admin is
 * never sent Super Admin rather than being trusted to hide it), and that
 * nobody may act on their own account's role or status.
 */
export function StaffPage() {
  const { user: me } = useAuth()
  const [staff, setStaff] = useState<StaffUser[] | null>(null)
  const [roles, setRoles] = useState<AssignableRole[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<StaffUser | null>(null)

  const apply = useCallback((result: { staff: StaffUser[]; roles: AssignableRole[] }) => {
    setStaff(result.staff)
    setRoles(result.roles)
    setError(null)
  }, [])

  const load = useCallback(
    () =>
      fetchStaff()
        .then(apply)
        .catch((failure: unknown) => setError(apiError(failure, 'Could not load your staff list.').message)),
    [apply],
  )

  useEffect(() => {
    let cancelled = false

    fetchStaff()
      .then((result) => {
        if (!cancelled) apply(result)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(apiError(failure, 'Could not load your staff list.').message)
      })

    return () => {
      cancelled = true
    }
  }, [apply])

  const setStatus = async (person: StaffUser, status: 'active' | 'suspended') => {
    setError(null)
    try {
      await apiClient.patch(`/users/${person.id}`, { status })
      await load()
    } catch (failure) {
      setError(apiError(failure, 'Could not change that account.').message)
    }
  }

  const columns = useMemo<DataColumn<StaffUser>[]>(
    () => [
      { key: 'name', header: 'Name' },
      { key: 'email', header: 'Email' },
      { key: 'role', header: 'Role', render: (row) => row.role_label },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <Badge
            tone={row.is_active ? 'success' : 'warning'}
            icon={row.is_active ? 'circle-check' : 'circle-slash'}
            size="sm"
          >
            {row.status_label}
          </Badge>
        ),
      },
      {
        key: 'deactivated_at',
        header: 'Suspended',
        render: (row) => (row.deactivated_at ? formatTimestamp(row.deactivated_at) : '—'),
      },
      {
        key: 'id',
        header: 'Actions',
        render: (row) => {
          // The server refuses both of these on your own account — you
          // cannot change your own role or lock yourself out. Offering
          // buttons that always fail would be worse than offering none.
          if (row.id === me?.id) {
            return <span style={{ color: 'var(--text-secondary)' }}>You</span>
          }

          return (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
                Edit
              </Button>
              {row.is_active ? (
                <Button size="sm" variant="ghost" onClick={() => void setStatus(row, 'suspended')}>
                  Suspend
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void setStatus(row, 'active')}>
                  Restore
                </Button>
              )}
            </span>
          )
        },
      },
    ],
    // setStatus is recreated per render and only closes over `load`; adding
    // it here would rebuild the columns on every keystroke in the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.id],
  )

  const filtered = useMemo(() => {
    if (!staff) return []
    const q = query.trim().toLowerCase()
    if (!q) return staff
    return staff.filter(
      (person) =>
        person.name.toLowerCase().includes(q) ||
        person.email.toLowerCase().includes(q) ||
        person.role_label.toLowerCase().includes(q),
    )
  }, [staff, query])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Staff administration" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card
        title="Staff"
        subtitle={staff ? `${staff.length} account${staff.length === 1 ? '' : 's'}` : undefined}
        padding="none"
        actions={
          <>
            <Input
              iconLeft="search"
              placeholder="Filter by name, email or role"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 260 }}
            />
            <Button iconLeft="user-plus" onClick={() => setCreating(true)}>
              Add colleague
            </Button>
          </>
        }
      >
        {staff !== null && staff.length === 0 ? (
          <EmptyState icon="users" title="No staff yet" description="Add a colleague to get started." />
        ) : (
          <DataTable<StaffUser>
            columns={columns}
            rows={filtered}
            dense
            emptyMessage={staff === null ? 'Loading…' : 'Nobody matches your filter'}
          />
        )}
      </Card>

      {creating && (
        <StaffDialog
          roles={roles}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}

      {editing && (
        <StaffDialog
          person={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

async function fetchStaff(): Promise<{ staff: StaffUser[]; roles: AssignableRole[] }> {
  const response = await apiClient.get<ApiSuccess<StaffUser[], StaffMeta>>('/users')

  return {
    staff: response.data.data,
    roles: response.data.meta?.assignable_roles ?? [],
  }
}

/**
 * One dialog for both adding and editing, because the fields are the same
 * bar the password — which only a new account has, since this module
 * deliberately offers no way for an administrator to reset somebody else's
 * (that is the one act an audit trail cannot tell apart from
 * impersonation).
 */
function StaffDialog({
  person,
  roles,
  onClose,
  onSaved,
}: {
  person?: StaffUser
  roles: AssignableRole[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const isNew = person === undefined
  const [form, setForm] = useState({
    name: person?.name ?? '',
    email: person?.email ?? '',
    role: person?.role ?? roles[0]?.value ?? '',
    password: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setMessage(null)

    try {
      if (isNew) {
        await apiClient.post('/users', form)
      } else {
        // PATCH, and only what an administrator may change. No password:
        // there is no endpoint for setting somebody else's.
        await apiClient.patch(`/users/${person.id}`, {
          name: form.name,
          email: form.email,
          role: form.role,
        })
      }

      await onSaved()
    } catch (failure) {
      const problem = apiError(failure, 'Could not save this account.')
      setErrors(fieldErrors(problem))
      setMessage(problem.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      title={isNew ? 'Add a colleague' : `Edit ${person.name}`}
      description={
        isNew
          ? 'They sign in with the password you set here. Ask them to change it from their own account afterwards.'
          : 'Changing a role takes effect immediately and is recorded in the audit log.'
      }
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button iconLeft="check" loading={submitting} onClick={() => void submit()}>
            {isNew ? 'Create account' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {message && Object.keys(errors).length === 0 && (
          <Alert tone="error" title="Not saved">
            {message}
          </Alert>
        )}

        <FormField label="Full name" htmlFor="s-name" required error={errors.name}>
          <Input id="s-name" value={form.name} onChange={set('name')} />
        </FormField>

        <FormField label="Work email" htmlFor="s-email" required error={errors.email}>
          <Input id="s-email" type="email" value={form.email} onChange={set('email')} />
        </FormField>

        <FormField
          label="Role"
          htmlFor="s-role"
          required
          hint="Decides what they can see and do. Recorded in the audit log."
          error={errors.role}
        >
          <Select
            id="s-role"
            value={form.role}
            onChange={set('role')}
            // Straight from the server. The client holds no copy of the
            // rule that a Corporate Admin may not appoint a Super Admin —
            // that role simply never arrives.
            options={roles.map((role) => ({ value: role.value, label: role.label }))}
          />
        </FormField>

        {isNew && (
          <FormField
            label="Initial password"
            htmlFor="s-password"
            required
            hint="At least 12 characters. Tell them in person, not by email, and ask them to change it."
            error={errors.password}
          >
            <Input
              id="s-password"
              type="password"
              value={form.password}
              onChange={set('password')}
              revealable
            />
          </FormField>
        )}
      </div>
    </Dialog>
  )
}
