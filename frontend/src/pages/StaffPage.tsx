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
import { PasswordMeter } from '../components/forms/PasswordMeter'
import { PageFill } from '../components/layout/PageFill'
import { Select } from '../components/forms/Select'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { formatTimestamp } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import { Checkbox } from '../components/forms/Checkbox'
import { isCorporateRole } from '../lib/navigation'
import type {
  AssignableRole,
  CapabilityOption,
  ClientCapability,
  RouteOption,
  StaffMeta,
  StaffUser,
} from '../types/staff'

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
/** One placeholder for every empty cell, rather than five copies of it. */
const dash = <span style={{ color: 'var(--text-secondary)' }}>—</span>

export function StaffPage() {
  const { user: me } = useAuth()
  const [staff, setStaff] = useState<StaffUser[] | null>(null)
  const [roles, setRoles] = useState<AssignableRole[]>([])
  const [capabilities, setCapabilities] = useState<CapabilityOption[]>([])
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [canInvite, setCanInvite] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<StaffUser | null>(null)

  const apply = useCallback(
    (result: {
      staff: StaffUser[]
      roles: AssignableRole[]
      capabilities: CapabilityOption[]
      routes: RouteOption[]
      canInvite: boolean
    }) => {
      setStaff(result.staff)
      setRoles(result.roles)
      setCapabilities(result.capabilities)
      setRoutes(result.routes)
      setCanInvite(result.canInvite)
      setError(null)
    },
    [],
  )

  /**
   * A refusal is not an error.
   *
   * The route no longer gates on a role slug — head office composes roles
   * carrying `staff.manage` and no slug list can know their names — so this
   * page is reachable by anybody and answers for itself. Somebody without the
   * permission gets a locked door rather than a red banner about a request
   * they did not knowingly make. Same shape as the role catalogue beside it.
   */
  const fail = useCallback((failure: unknown) => {
    const problem = apiError(failure, 'Could not load your staff list.')

    if (problem.code === 'FORBIDDEN') {
      setRefused(true)

      return
    }

    setError(problem.message)
  }, [])

  const load = useCallback(() => fetchStaff().then(apply).catch(fail), [apply, fail])

  useEffect(() => {
    let cancelled = false

    fetchStaff()
      .then((result) => {
        if (!cancelled) apply(result)
      })
      .catch((failure: unknown) => {
        if (!cancelled) fail(failure)
      })

    return () => {
      cancelled = true
    }
  }, [apply, fail])

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
      {
        // Name over email in one column rather than two. This table had
        // seven, and a staff list is scanned for a person — the address is
        // how you tell two Josephs apart, not something read on its own.
        key: 'name',
        card: 'title',
        header: 'Person',
        render: (row) => (
          <span style={{ display: 'block', minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 'var(--weight-medium)' }}>{row.name}</span>
            <span style={{ display: 'block', font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
              {row.email}
            </span>
          </span>
        ),
      },
      { key: 'phone', card: 'meta', header: 'Phone', render: (row) => row.phone ?? dash },
      { key: 'role', card: 'meta', header: 'Role', render: (row) => row.role_label },
      {
        // What this person can do beyond their role — the switches their
        // administrator set (App\Enums\ClientCapability). Named from the
        // server's catalogue, never from a copy here.
        key: 'capabilities',
        card: 'hide',
        header: 'Access',
        render: (row) => {
          const names = row.capabilities
            .map((slug) => capabilities.find((c) => c.slug === slug)?.label ?? slug)
            .concat(row.books_without_approval ? ['No approval'] : [])
          return names.length === 0 ? (
            dash
          ) : (
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
              {names.map((name) => (
                <Badge key={name} tone="info" size="sm">
                  {name}
                </Badge>
              ))}
            </span>
          )
        },
      },
      {
        // A count, not the names. A cash-run roster is four or five
        // circuits, and spelling them out here would push everything else
        // off the row; the names are one click away, in the dialog that
        // sets them.
        key: 'route_ids',
        card: 'meta',
        header: 'Routes',
        numeric: true,
        render: (row) =>
          row.route_ids === undefined || row.route_ids.length === 0 ? dash : row.route_ids.length,
      },
      {
        key: 'status',
        card: 'status',
        header: 'Status',
        render: (row) => (
          <span style={{ display: 'block', minWidth: 0 }}>
            <Badge
              tone={row.is_active ? 'success' : 'warning'}
              icon={row.is_active ? 'circle-check' : 'circle-slash'}
              size="sm"
            >
              {row.status_label}
            </Badge>
            {/* Under the badge rather than in a column of its own, which
                stood empty on every account that is still working here. */}
            {row.deactivated_at !== null && (
              <span
                style={{ display: 'block', font: 'var(--type-caption)', color: 'var(--text-secondary)' }}
              >
                {formatTimestamp(row.deactivated_at)}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'id',
        card: 'meta',
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
    [me?.id, capabilities],
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

  if (refused) {
    return (
      <Card>
        <EmptyState
          icon="lock"
          title="Staff administration is not available to your account"
          description="Ask an administrator for staff management."
        />
      </Card>
    )
  }

  return (
    <PageFill>
      {error && (
        <Alert tone="error" title="Staff administration" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <PageFill.Flex>
      <Card
        fill
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
            fill
            emptyMessage={staff === null ? 'Loading…' : 'Nobody matches your filter'}
          />
        )}
      </Card>
      </PageFill.Flex>

      {creating && (
        <StaffDialog
          roles={roles}
          capabilities={capabilities}
          routes={routes}
          canInvite={canInvite}
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
          capabilities={capabilities}
          routes={routes}
          canInvite={canInvite}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </PageFill>
  )
}

async function fetchStaff(): Promise<{
  staff: StaffUser[]
  roles: AssignableRole[]
  capabilities: CapabilityOption[]
  routes: RouteOption[]
  canInvite: boolean
}> {
  const response = await apiClient.get<ApiSuccess<StaffUser[], StaffMeta>>('/users')

  return {
    staff: response.data.data,
    roles: response.data.meta?.assignable_roles ?? [],
    capabilities: response.data.meta?.capabilities ?? [],
    // Whether the platform can actually deliver an invitation. False on an
    // API older than the feature, and false whenever mail is switched off —
    // in both cases the dialog offers the password path only, rather than an
    // option that would create an account nobody can reach.
    canInvite: response.data.meta?.can_invite ?? false,
    // Empty for a platform account, which belongs to no client and so has
    // no routes to put anybody on. The dialog hides the panel rather than
    // showing an empty one.
    routes: response.data.meta?.routes ?? [],
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
  capabilities,
  routes,
  canInvite,
  onClose,
  onSaved,
}: {
  person?: StaffUser
  roles: AssignableRole[]
  capabilities: CapabilityOption[]
  routes: RouteOption[]
  /** Whether the platform can deliver an invitation — the server's answer. */
  canInvite: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const isNew = person === undefined
  const [form, setForm] = useState({
    name: person?.name ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    role: person?.role ?? roles[0]?.value ?? '',
    password: '',
    // Defaults off, so the field an administrator already knows is the one
    // they see. Turning it on is a deliberate act, and it is only offered
    // where the platform can keep the promise.
    invite: false,
  })
  // The client's switches for this person (App\Enums\ClientCapability).
  // Offered only for a client's roles — the server refuses them on a
  // platform account — and only when the API served a catalogue to
  // choose from.
  const [granted, setGranted] = useState<ClientCapability[]>(person?.capabilities ?? [])
  const [bookWithoutApproval, setBookWithoutApproval] = useState(person?.books_without_approval ?? false)
  const offersCapabilities = capabilities.length > 0 && isCorporateRole(form.role)

  // Which circuits this person rides (ADR-0045 §8). A roster, not a
  // permission — but it is offered under the same condition as the
  // switches above, because a route belongs to a client and a platform
  // account belongs to none.
  const [riding, setRiding] = useState<number[]>(person?.route_ids ?? [])
  const offersRoutes = routes.length > 0 && isCorporateRole(form.role)
  const toggleRoute = (id: number, on: boolean) =>
    setRiding((current) => (on ? [...current.filter((r) => r !== id), id] : current.filter((r) => r !== id)))

  const toggle = (slug: ClientCapability, on: boolean) =>
    setGranted((current) => (on ? [...current.filter((c) => c !== slug), slug] : current.filter((c) => c !== slug)))
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
      // The switch panel travels whole, and only for a client's roles: a
      // switch turned off must reach the server as an empty list, not as
      // an absent field the server reads as "keep what was there".
      const switches = offersCapabilities
        ? { capabilities: granted, books_without_approval: bookWithoutApproval }
        : {}
      // Same rule for the roster, and the same reason: taking somebody off
      // the Monday run has to reach the server as an empty list, not as an
      // absent field it reads as "leave them on it".
      const roster = offersRoutes ? { route_ids: riding } : {}
      if (isNew) {
        // `password` is omitted rather than sent empty when an invitation is
        // going out: the server drops the requirement for an invite but still
        // holds a *present* password to the length floor, so an empty string
        // would be refused for a field the administrator never filled in.
        const { invite, password, ...rest } = form
        const wayIn = invite ? { invite: true } : { password }

        await apiClient.post('/users', { ...rest, ...wayIn, ...switches, ...roster })
      } else {
        // PATCH, and only what an administrator may change. No password:
        // there is no endpoint for setting somebody else's.
        await apiClient.patch(`/users/${person.id}`, {
          name: form.name,
          email: form.email,
          phone: form.phone,
          role: form.role,
          ...switches,
          ...roster,
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
      title={isNew ? 'Add a colleague' : person.name}
      // One line, and only for the case that needs one. The edit form said
      // "changes are recorded in the audit log", which is true of every
      // write in the platform and told nobody anything.
      //
      // It follows the choice below it, because the two paths end somewhere
      // different and a sentence that named the wrong one would be the screen
      // telling the administrator the opposite of what is about to happen.
      // Caught in a browser with the box ticked, where the dialog still
      // promised a password nobody was going to set.
      description={
        isNew
          ? form.invite
            ? 'They get an email with a link to set their own password.'
            : 'They sign in with the password you set here.'
          : undefined
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

        {/* Two columns: four short fields stacked full-width made a dialog
            you scrolled to reach the button of. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <FormField label="Full name" htmlFor="s-name" required error={errors.name}>
            <Input id="s-name" value={form.name} onChange={set('name')} />
          </FormField>

          <FormField label="Work email" htmlFor="s-email" required error={errors.email}>
            <Input id="s-email" type="email" value={form.email} onChange={set('email')} />
          </FormField>

          {/* The number a driver is given when this person travels. Kept on
              the account so a booking raised for them is dispatched against
              something somebody checked once, not retyped from memory. */}
          <FormField label="Phone" htmlFor="s-phone" required error={errors.phone}>
            <Input
              id="s-phone"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+256700000000"
            />
          </FormField>

          <FormField label="Role" htmlFor="s-role" required error={errors.role}>
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
        </div>

        {offersCapabilities && (
          <fieldset
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-card)',
              padding: 'var(--space-4)',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <legend style={{ font: 'var(--type-label)', color: 'var(--text-secondary)', padding: '0 var(--space-2)' }}>
              Can also
            </legend>
            {errors.capabilities && (
              <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--kr-error)' }}>{errors.capabilities}</p>
            )}
            {capabilities.map((option) => (
              <Checkbox
                key={option.slug}
                id={`s-cap-${option.slug}`}
                label={option.label}
                hint={option.description}
                checked={granted.includes(option.slug)}
                onChange={(e) => toggle(option.slug, e.target.checked)}
              />
            ))}
            <Checkbox
              id="s-cap-no-approval"
              label="Book without approval"
              hint="Their transport requests are approved on their behalf."
              checked={bookWithoutApproval}
              onChange={(e) => setBookWithoutApproval(e.target.checked)}
            />
          </fieldset>
        )}

        {offersRoutes && (
          <fieldset
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-card)',
              padding: 'var(--space-4)',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              // Scrolls rather than growing: a client with thirty circuits
              // would otherwise push the save button off the dialog.
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            <legend
              style={{ font: 'var(--type-label)', color: 'var(--text-secondary)', padding: '0 var(--space-2)' }}
            >
              Routes
            </legend>
            {errors.route_ids && (
              <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--kr-error)' }}>{errors.route_ids}</p>
            )}
            {routes.map((route) => (
              <Checkbox
                key={route.id}
                id={`s-route-${route.id}`}
                label={route.name}
                checked={riding.includes(route.id)}
                onChange={(e) => toggleRoute(route.id, e.target.checked)}
              />
            ))}
          </fieldset>
        )}

        {isNew && canInvite && (
          /*
            How this person gets in. Offered only when the platform can
            actually send the email — `meta.can_invite` is the server's answer
            to that, and with mail off the choice is not rendered at all
            rather than shown and refused on save.

            An invitation is the better default where it works: the
            administrator never handles a password, and there is no secret to
            read out over a phone. The other path stays because mail is a
            setting somebody can switch off.
          */
          <Checkbox
            id="s-invite"
            label="Email them a link to set their own password"
            checked={form.invite}
            onChange={(e) => setForm((f) => ({ ...f, invite: e.target.checked }))}
          />
        )}

        {isNew && !form.invite && (
          /*
            The length half of this hint is gone — the meter's checklist states
            the floor, from the shared constant, rather than a number typed
            here that outlived two changes to the server's rule. "Tell them in
            person" stays: it is the one thing on this field that is neither
            the label nor the rule, and a password mailed to somebody is a
            password in their inbox forever.
          */
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <FormField
              label="Initial password"
              htmlFor="s-password"
              required
              hint="Tell them in person, not by email."
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

            <PasswordMeter password={form.password} />
          </div>
        )}
      </div>
    </Dialog>
  )
}
