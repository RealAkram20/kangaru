import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { formatDate } from '../lib/format'
import { categoryLabel, categoryOptions, useVehicleCategories } from '../lib/vehicleCategories'
import type { ApiSuccess } from '../types/api'
import type { Driver } from '../types/driver'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'
import { PasswordMeter } from '../components/forms/PasswordMeter'
import { PageFill } from '../components/layout/PageFill'
import { DriverDocumentsDialog } from './drivers/DriverDocumentsDialog'
import { DriverFormDialog } from './drivers/DriverFormDialog'
import { DriverPayoutDialog } from './drivers/DriverPayoutDialog'

const STATUS_TONE: Record<Driver['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  inactive: 'neutral',
}

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[] | null>(null)
  const { categories } = useVehicleCategories()
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // '' is every category. A depot's own question is "who is out in what",
  // so the unfiltered roster stays the opening answer.
  const [category, setCategory] = useState('')
  const [managing, setManaging] = useState<Driver | null>(null)
  // ADR-0033. Separate state from `managing`: a sign-in and a licence are
  // different questions, and one dialog answering both would be the
  // "settings screen" mistake at a smaller scale.
  const [reviewing, setReviewing] = useState<Driver | null>(null)
  /** ADR-0042. Whose payout destination the office is reading, if any. */
  const [payout, setPayout] = useState<Driver | null>(null)
  /**
   * ADR-0048 §8. The driver being created or edited.
   *
   * Three states in one value, and the third is why it is not a boolean: a
   * `Driver` is an edit, `'new'` is a creation, and `null` is closed. A
   * separate `creating` flag alongside an `editing` object is the pair that
   * can hold both at once and render two dialogs on top of each other.
   */
  const [editing, setEditing] = useState<Driver | 'new' | null>(null)

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<Driver[]>>('/drivers')
        .then((response) => {
          setDrivers(response.data.data)
          setError(null)
        })
        .catch(() => setError('Could not load drivers.')),
    [],
  )

  // Deliberately `.then()` rather than `await` inside an async effect body:
  // `react-hooks/set-state-in-effect` reads a synchronous call to a
  // state-setting helper as a set during render, and it is right to — the
  // promise chain defers the write to a microtask, which is what we mean.
  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!drivers) return []
    const q = query.trim().toLowerCase()

    /*
      Category first, and it reads the *vehicle's* category rather than
      anything on the driver: a driver has no category of their own, only
      whatever they are holding. That is also why a driver with no vehicle
      falls out of a category filter instead of matching every one of them —
      the depot allocates theirs per shift, so "is this rider on a boda" has
      no answer yet, and answering it anyway is the guess this screen must not
      make.
    */
    const byCategory =
      category === '' ? drivers : drivers.filter((d) => d.vehicle?.category === category)

    if (!q) return byCategory

    return byCategory.filter(
      (d) => d.name.toLowerCase().includes(q) || d.license_number.toLowerCase().includes(q),
    )
  }, [drivers, query, category])

  const columns: DataColumn<Driver>[] = useMemo(
    () => [
      { key: 'name', card: 'title', header: 'Name', sortable: true },
      { key: 'phone', card: 'meta', header: 'Phone' },
      { key: 'license_number', card: 'meta', header: 'License number' },
      {
        /**
         * What they drive, and whose it is (ADR-0048 §7).
         *
         * The plate is the answer to "who is out in what", and the badge
         * beside it carries the distinction `vehicle_id` alone cannot: a boda
         * rider's own machine versus a depot car handed out this morning.
         *
         * **Never colour alone** (`docs/screen-rules.md` §6) — "Own" is a
         * word, not a green dot.
         */
        key: 'vehicle_id',
        card: 'meta',
        header: 'Vehicle',
        render: (row) =>
          row.vehicle_id === null ? (
            // An em dash, not "None" and not a zero: the depot allocates one
            // per shift for these drivers, so there is nothing to name here
            // rather than nothing at all.
            <span style={{ color: 'var(--text-secondary)' }} title="Allocated per shift">
              —
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {row.vehicle?.registration_number ?? `#${row.vehicle_id}`}
              </span>
              {row.owns_vehicle && (
                <Badge tone="neutral" icon="car">
                  Own
                </Badge>
              )}
              {/*
                What they are out in, in the office's own word for it. Plain
                secondary text rather than a second badge: "Own" is a fact
                about the arrangement and earns the emphasis, whereas the
                category is how the row is *sorted* in somebody's head.
              */}
              {row.vehicle?.category != null && (
                <span style={{ color: 'var(--text-secondary)' }}>
                  {categoryLabel(categories, row.vehicle.category)}
                </span>
              )}
            </span>
          ),
      },
      {
        key: 'license_expiry',
        card: 'meta',
        header: 'License expiry',
        sortable: true,
        /*
          `formatDate`, because this column was rendering the raw cast —
          `2028-08-17T00:00:00.000000Z` — for what is a calendar date. It read
          as machine output and cost roughly 150px of a table that already
          scrolls sideways.

          Sorting is unaffected: `DataTable` sorts on the row value, not on
          what `render` returns, so the ISO string still orders correctly.
        */
        render: (row) => formatDate(row.license_expiry),
      },
      {
        key: 'status',
        card: 'status',
        header: 'Status',
        render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
      },
      {
        // The column that did not exist before ADR-0016, and the reason the
        // gap survived so long: nothing on any screen said whether a driver
        // could sign in, so nobody noticed that none of them could.
        key: 'account',
        card: 'meta',
        header: 'Sign-in',
        render: (row) =>
          row.account === null ? (
            <Badge tone="neutral" icon="user-x">
              No account
            </Badge>
          ) : (
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
              title={row.account.email}
            >
              <Badge
                tone={row.account.status === 'active' ? 'success' : 'warning'}
                icon="user-check"
              >
                {row.account.status === 'active' ? 'Can sign in' : 'Suspended'}
              </Badge>
            </span>
          ),
      },
      {
        key: 'id',
        card: 'meta',
        header: '',
        render: (row) => (
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            {/*
              ADR-0033. The office half of driver documents — and it ships
              with the feature rather than after it, because ADR-0029 created
              an obligation with no surface and nothing ever discharged it.
            */}
            <Button size="sm" variant="secondary" onClick={() => setReviewing(row)}>
              Documents
            </Button>
            {/*
              ADR-0042. The office half of payout destinations, shipping with
              the feature rather than after it — the completeness census found
              four backends nobody in the office could reach, and a destination
              a clerk cannot read is a form filled in for nobody.
            */}
            <Button size="sm" variant="secondary" onClick={() => setPayout(row)}>
              Payout
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setManaging(row)}>
              {row.account === null ? 'Give sign-in' : 'Manage sign-in'}
            </Button>
            {/*
              ADR-0048 §8. The action that has never existed: until now the
              only way a driver reached this table was a seeder.
            */}
            <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
              Edit
            </Button>
          </span>
        ),
      },
    ],
    // `categories` only renames what is already on the row, so a slow list
    // costs a relabel and never a wrong plate.
    [categories],
  )

  return (
    <PageFill>
      <PageFill.Flex>
      <Card
        fill
        title="Drivers"
        // A filtered table under "19 total" reads as a table that lost 18
        // rows. When a filter is on, the count says what is on screen and what
        // it was cut from.
        subtitle={
          drivers
            ? filtered.length === drivers.length
              ? `${drivers.length} total`
              : `${filtered.length} of ${drivers.length}`
            : undefined
        }
        actions={
          <span
            style={{
              display: 'inline-flex',
              // Claims the header's free space rather than being sized by its
              // own contents: the title needs a fraction of what it was given,
              // and without this the chooser pushed the action button onto a
              // second line on a full-width desktop.
              flexGrow: 1,
              gap: 'var(--space-2)',
              alignItems: 'center',
              // The filter shrinks before the action does: on a narrow screen
              // "New driver" is the thing somebody came here to press.
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {/*
              Before the text box, because it answers the coarser question a
              depot actually asks first: which of these people are out on a boda
              this morning, not which one is called Ada.
            */}
            <Select
              aria-label="Filter by vehicle category"
              // The empty value is a real choice here, not an unfilled field:
              // "All categories" is where the screen opens and where it goes
              // back to.
              placeholder="All categories"
              options={categoryOptions(categories ?? [], category)}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ width: 'min(190px, 100%)' }}
            />
            <Input
              iconLeft="search"
              placeholder="Filter by name or license number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Takes what is left after the chooser and the action, rather
              // than a fixed width that pushed "New driver" onto a second
              // line. `minWidth: 0` because a flex item's default floor is
              // its content.
              style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 260 }}
            />
            <Button iconLeft="plus" onClick={() => setEditing('new')}>
              New driver
            </Button>
          </span>
        }
        padding="none"
      >
        {error ? (
          <p style={{ padding: 'var(--space-6)', color: 'var(--kr-error)' }}>{error}</p>
        ) : (
          <DataTable<Driver>
            columns={columns}
            rows={filtered}
            fill
            emptyMessage={
              drivers === null
                ? 'Loading…'
                : query || category
                  ? 'No drivers match your filter'
                  : 'No drivers yet — use New driver to add the first one'
            }
          />
        )}
      </Card>
      </PageFill.Flex>

      {reviewing && (
        <DriverDocumentsDialog driver={reviewing} onClose={() => setReviewing(null)} />
      )}

      {payout && <DriverPayoutDialog driver={payout} onClose={() => setPayout(null)} />}

      {editing !== null && (
        <DriverFormDialog
          driver={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load()
            setEditing(null)
          }}
        />
      )}

      {managing && (
        <DriverAccountDialog
          driver={managing}
          onClose={() => setManaging(null)}
          onSaved={async () => {
            await load()
            setManaging(null)
          }}
        />
      )}
    </PageFill>
  )
}

/**
 * Attaching or removing the login a driver signs in with (ADR-0016).
 *
 * Two states in one dialog rather than two dialogs, because the question an
 * administrator arrives with is the same either way — "can this person use
 * the app?" — and the answer determines which half they see.
 */
function DriverAccountDialog({
  driver,
  onClose,
  onSaved,
}: {
  driver: Driver
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({ email: driver.email ?? '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setSubmitting(true)
    setErrors({})
    setMessage(null)

    try {
      await action()
      await onSaved()
    } catch (failure) {
      const problem = apiError(failure, fallback)
      setErrors(fieldErrors(problem))
      setMessage(problem.message)
    } finally {
      setSubmitting(false)
    }
  }

  const attach = () =>
    run(
      () => apiClient.post(`/drivers/${driver.id}/account`, form),
      'Could not give this driver a sign-in.',
    )

  const detach = () =>
    run(
      () => apiClient.delete(`/drivers/${driver.id}/account`),
      "Could not remove this driver's sign-in.",
    )

  const hasAccount = driver.account !== null

  return (
    <Dialog
      open
      title={hasAccount ? `${driver.name}'s sign-in` : `Give ${driver.name} a sign-in`}
      description={
        hasAccount
          ? 'Removing the sign-in ends any session they have open right now, including the app on their phone. The account itself is kept.'
          : 'They sign in with the password you set here, and can then accept trips and record odometer readings. Ask them to change it from their own profile afterwards.'
      }
      onClose={onClose}
      width={560}
      tone={hasAccount ? 'warning' : 'default'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {hasAccount ? 'Close' : 'Cancel'}
          </Button>
          {hasAccount ? (
            <Button variant="destructive" onClick={() => void detach()} disabled={submitting}>
              {submitting ? 'Removing…' : 'Remove sign-in'}
            </Button>
          ) : (
            <Button onClick={() => void attach()} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create sign-in'}
            </Button>
          )}
        </>
      }
    >
      {message && Object.keys(errors).length === 0 && (
        <Alert tone="error" title="Sign-in" onDismiss={() => setMessage(null)}>
          {message}
        </Alert>
      )}

      {hasAccount ? (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 'var(--space-2) var(--space-4)',
            margin: 0,
          }}
        >
          <dt style={{ color: 'var(--text-secondary)' }}>Signs in as</dt>
          <dd style={{ margin: 0 }}>{driver.account?.email}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Role</dt>
          <dd style={{ margin: 0 }}>{driver.account?.role.replace(/_/g, ' ')}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Account</dt>
          <dd style={{ margin: 0 }}>{driver.account?.status}</dd>
        </dl>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <FormField label="Email" htmlFor="driver-account-email" error={errors.email} required>
            <Input
              id="driver-account-email"
              type="email"
              iconLeft="mail"
              value={form.email}
              onChange={set('email')}
              required
            />
          </FormField>

          {/*
            No `hint`. It used to read "At least 12 characters." — the number
            the server held before `PasswordPolicy` brought every door to one
            floor, and the copy the owner reported. Restating the floor here
            *and* in the meter's checklist below would be the rule twice
            (`docs/screen-rules.md` §9), so the meter states it, from the
            shared constant, the moment there is anything to state it about.
          */}
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <FormField
              label="Password"
              htmlFor="driver-account-password"
              error={errors.password}
              required
            >
              <Input
                id="driver-account-password"
                type="password"
                iconLeft="lock"
                value={form.password}
                onChange={set('password')}
                revealable
                required
              />
            </FormField>

            <PasswordMeter password={form.password} />
          </div>
        </div>
      )}
    </Dialog>
  )
}
