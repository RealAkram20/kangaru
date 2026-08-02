import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Identifier } from '../components/core/Identifier'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { EmptyState } from '../components/feedback/EmptyState'
import { Checkbox } from '../components/forms/Checkbox'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'
import type { Role, RolesMeta } from '../types/role'

async function fetchRoles(): Promise<{ roles: Role[]; meta: RolesMeta | null }> {
  const response = await apiClient.get<ApiSuccess<Role[], RolesMeta>>('/roles')

  return { roles: response.data.data, meta: response.data.meta ?? null }
}

/**
 * The role catalogue (ADR-0004).
 *
 * Roles became data in the permission migration, and the API to compose
 * them has been complete and exercised since — but the only way to reach it
 * was curl. This is the screen, so "a client wants a Regional Dispatcher"
 * stops being a release.
 *
 * ## Every rule here belongs to the server
 *
 * This page holds no copy of who may do what. It reads three things off
 * `meta` and reflects them:
 *
 * - `can_manage` — whether to offer writing at all. A Corporate Admin holds
 *   `staff.view` and may read the catalogue (they assign from it on the
 *   Staff page) but not author it, and gets the same table read-only.
 * - `grantable` — the permissions the caller holds, which under ADR-0004's
 *   escalation rule are exactly the ones they may put into a role. Anything
 *   outside it renders disabled with the reason, rather than being offered
 *   and refused with a 422 after the fact.
 * - `catalogue` — the permissions that exist, already grouped. A permission
 *   added to the enum appears here without this file changing.
 *
 * That is also why the route is not behind `RequireNavAccess`: it gates on
 * role slug, and this feature's entire purpose is roles that the slug list
 * cannot know about. A custom role holding `roles.manage` must be able to
 * open this page, so access is decided by whether the API answers.
 */
export function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [meta, setMeta] = useState<RolesMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Role | null>(null)

  const apply = useCallback((result: { roles: Role[]; meta: RolesMeta | null }) => {
    setRoles(result.roles)
    setMeta(result.meta)
    setError(null)
    setRefused(false)
  }, [])

  const fail = useCallback((failure: unknown) => {
    const problem = apiError(failure, 'Could not load the role catalogue.')
    // 403 is not a fault to apologise for — it is an answer. Telling
    // somebody the catalogue "failed to load" when they simply may not read
    // it sends them looking for a problem that is not there.
    if (problem.code === 'FORBIDDEN') {
      setRefused(true)
      setRoles([])
      return
    }
    setError(problem.message)
  }, [])

  // One loader for the first paint and for every reload after a save, so the
  // two cannot drift in how they treat a refusal. No cancellation flag: it
  // only ever assigns state a second run would assign again, which is what
  // makes it safe under StrictMode's double mount.
  const load = useCallback(() => fetchRoles().then(apply, fail), [apply, fail])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = meta?.can_manage ?? false

  const rows = useMemo(() => (roles ?? []).map((role) => ({ ...role, id: role.slug })), [roles])

  const columns = useMemo<DataColumn<(typeof rows)[number]>[]>(
    () => [
      {
        key: 'name',
        header: 'Role',
        wrap: true,
        render: (row) => (
          <span style={{ display: 'block', maxWidth: 320 }}>
            <span style={{ fontWeight: 'var(--weight-semibold)' }}>{row.name}</span>
            {row.description && (
              <span
                style={{
                  display: 'block',
                  font: 'var(--type-caption)',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'normal',
                }}
              >
                {row.description}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'slug',
        header: 'Key',
        // The slug is what `users.role` stores and what the staff endpoints
        // accept, so it is an identifier a person may have to quote.
        render: (row) => <Identifier>{row.slug}</Identifier>,
      },
      {
        key: 'is_system',
        header: 'Type',
        render: (row) =>
          row.is_system ? (
            <Badge tone="neutral" icon="lock" size="sm">
              Built in
            </Badge>
          ) : (
            <Badge tone="info" icon="sparkles" size="sm">
              Custom
            </Badge>
          ),
      },
      {
        key: 'permissions',
        header: 'Permissions',
        numeric: true,
        render: (row) => row.permissions.length,
      },
      {
        key: 'users_count',
        header: 'Accounts',
        numeric: true,
        render: (row) => row.users_count ?? 0,
      },
      {
        key: 'id',
        header: 'Actions',
        render: (row) => (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
              {canManage ? 'Edit' : 'View'}
            </Button>
            {/* A built-in role is never deletable — seeders, tests and every
                existing `users.role` value refer to it by slug. The server
                refuses it too; not offering the button is the difference
                between a rule and a trap. */}
            {canManage && !row.is_system && (
              <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>
                Delete
              </Button>
            )}
          </span>
        ),
      },
    ],
    [canManage],
  )

  if (refused) {
    return (
      <Card>
        <EmptyState
          icon="lock"
          title="Roles are not available to your account"
          description="Composing roles is reserved for whoever holds role management. Ask a Super Admin if you need to see what a role grants."
        />
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Role catalogue" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {roles !== null && !canManage && (
        <Alert tone="info" title="Read only">
          You can see what each role grants, which is what the Staff page assigns from. Changing a
          role needs role management — ask a Super Admin.
        </Alert>
      )}

      <Card
        title="Roles"
        subtitle={
          roles
            ? `${roles.length} role${roles.length === 1 ? '' : 's'} · ${roles.filter((r) => !r.is_system).length} custom`
            : undefined
        }
        padding="none"
        actions={
          canManage ? (
            <Button iconLeft="plus" onClick={() => setEditing('new')}>
              New role
            </Button>
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          dense
          emptyMessage={roles === null ? 'Loading…' : 'No roles'}
        />
      </Card>

      {editing && meta && (
        <RoleDialog
          role={editing === 'new' ? undefined : editing}
          meta={meta}
          readOnly={!canManage}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}

      {deleting && (
        <DeleteRoleDialog
          role={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

/**
 * One dialog for creating, editing and reading a role.
 *
 * The permission grid is the whole feature: a role is only meaningful as
 * the set of things it lets somebody do, and a list of thirty checkboxes
 * grouped by subject is the shortest path from "what should a Regional
 * Dispatcher be able to do" to a saved answer.
 */
function RoleDialog({
  role,
  meta,
  readOnly,
  onClose,
  onSaved,
}: {
  role?: Role
  meta: RolesMeta
  readOnly: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const isNew = role === undefined
  const [name, setName] = useState(role?.name ?? '')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState(role?.description ?? '')
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const grantable = useMemo(() => new Set(meta.grantable), [meta.grantable])

  const toggle = (permission: string) =>
    setSelected((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission],
    )

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setMessage(null)

    try {
      if (isNew) {
        await apiClient.post('/roles', {
          name,
          // Omitted rather than sent empty: the server derives it from the
          // name, and an empty string would fail the slug pattern.
          ...(slug.trim() === '' ? {} : { slug: slug.trim() }),
          description: description.trim() === '' ? null : description,
          permissions: selected,
        })
      } else {
        // A built-in role's name is immutable server-side, so it is not
        // sent — PATCH carries only what may actually change.
        await apiClient.patch(`/roles/${role.slug}`, {
          ...(role.is_system ? {} : { name }),
          description: description.trim() === '' ? null : description,
          permissions: selected,
        })
      }

      await onSaved()
    } catch (failure) {
      const problem = apiError(failure, 'Could not save this role.')
      setErrors(fieldErrors(problem))
      setMessage(problem.message)
    } finally {
      setSubmitting(false)
    }
  }

  const groups = Object.entries(meta.catalogue)

  return (
    <Dialog
      open
      title={isNew ? 'New role' : role.name}
      description={
        readOnly
          ? 'What this role lets an account do.'
          : isNew
            ? 'A role is a named set of permissions. Anyone holding it gets exactly these abilities and nothing else.'
            : 'Changes take effect immediately for every account holding this role, and are recorded in the audit log.'
      }
      onClose={onClose}
      width={720}
      footer={
        readOnly ? (
          // "Done", not "Close" — Dialog's own dismiss X is already labelled
          // Close, and two controls with the same accessible name in one
          // dialog is a screen reader reading the same word twice.
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button iconLeft="check" loading={submitting} onClick={() => void submit()}>
              {isNew ? 'Create role' : 'Save changes'}
            </Button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {message && Object.keys(errors).length === 0 && (
          <Alert tone="error" title="Not saved">
            {message}
          </Alert>
        )}

        <FormField
          label="Name"
          htmlFor="r-name"
          required={!readOnly}
          hint={
            !isNew && role.is_system
              ? 'A built-in role cannot be renamed — accounts refer to it by its key. Its permissions can still be changed.'
              : undefined
          }
          error={errors.name}
        >
          <Input
            id="r-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly || (!isNew && role.is_system)}
          />
        </FormField>

        {isNew && (
          <FormField
            label="Key"
            htmlFor="r-slug"
            hint="Optional. Lowercase letters, numbers and underscores. Left blank it is derived from the name, and it can never be changed afterwards."
            error={errors.slug}
          >
            <Input
              id="r-slug"
              mono
              value={slug}
              placeholder="regional_dispatcher"
              onChange={(e) => setSlug(e.target.value)}
            />
          </FormField>
        )}

        <FormField
          label="Description"
          htmlFor="r-description"
          hint="What this role is for, in a sentence. Shown to whoever assigns it."
          error={errors.description}
        >
          <Input
            id="r-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
          />
        </FormField>

        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              marginBottom: 6,
            }}
          >
            <span style={{ font: 'var(--type-label)', color: 'var(--text-body)' }}>
              Permissions
              {!readOnly && (
                <span aria-hidden="true" style={{ color: 'var(--kr-error)', marginLeft: 3 }}>
                  *
                </span>
              )}
            </span>
            <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
              {/* "granted" to a reader, "selected" to whoever is choosing —
                  nobody viewing a role has selected anything. */}
              {selected.length} {readOnly ? 'granted' : 'selected'}
            </span>
          </div>

          {errors.permissions && (
            <p
              style={{
                font: 'var(--type-caption)',
                color: 'var(--kr-error)',
                marginBottom: 6,
              }}
            >
              {errors.permissions}
            </p>
          )}

          <div
            style={{
              maxHeight: 360,
              overflowY: 'auto',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-input)',
              padding: 'var(--space-3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            {groups.map(([group, permissions]) => (
              <fieldset key={group} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
                <legend
                  style={{
                    font: 'var(--type-overline)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-caps)',
                    color: 'var(--text-secondary)',
                    padding: '0 0 4px',
                  }}
                >
                  {group}
                </legend>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 2,
                  }}
                >
                  {permissions.map((permission) => {
                    const held = grantable.has(permission.value)
                    return (
                      <Checkbox
                        key={permission.value}
                        id={`p-${permission.value}`}
                        label={permission.label}
                        // The escalation rule made visible. ADR-0004 refuses
                        // a role granting more than its author holds; showing
                        // why up front beats a 422 after they have composed
                        // the whole thing.
                        //
                        // Only while composing, though: to a reader nothing
                        // is being granted, so "you do not hold this" answers
                        // a question they did not ask and costs them the
                        // permission key, which is the thing worth showing.
                        hint={
                          readOnly || held ? (
                            <Identifier size="xs">{permission.value}</Identifier>
                          ) : (
                            'You do not hold this permission yourself'
                          )
                        }
                        checked={selected.includes(permission.value)}
                        disabled={readOnly || !held}
                        onChange={() => toggle(permission.value)}
                      />
                    )
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Deleting a custom role.
 *
 * Confirmed rather than immediate, because the server's own refusal only
 * covers the recoverable half: it blocks deleting a role somebody holds,
 * but a role nobody holds yet is deleted without complaint, and rebuilding
 * a permission set from memory is not something anyone should do by
 * misclick.
 */
function DeleteRoleDialog({
  role,
  onClose,
  onDeleted,
}: {
  role: Role
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const remove = async () => {
    setSubmitting(true)
    setMessage(null)

    try {
      await apiClient.delete(`/roles/${role.slug}`)
      await onDeleted()
    } catch (failure) {
      // Includes the 409 ROLE_IN_USE, whose message already names how many
      // accounts still hold the role and what to do about it.
      setMessage(apiError(failure, 'Could not delete this role.').message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      tone="destructive"
      title={`Delete ${role.name}?`}
      description="This cannot be undone. Accounts holding this role would lose every permission it grants, so the server refuses while anyone still holds it."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" loading={submitting} onClick={() => void remove()}>
            Delete role
          </Button>
        </>
      }
    >
      {message && (
        <Alert tone="error" title="Not deleted">
          {message}
        </Alert>
      )}
    </Dialog>
  )
}
