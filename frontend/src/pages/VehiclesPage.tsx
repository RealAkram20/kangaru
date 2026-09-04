import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { canManageFleet } from '../lib/fleet'
import { categoryLabel, categoryOptions, useVehicleCategories } from '../lib/vehicleCategories'
import type { ApiSuccess } from '../types/api'
import type { Vehicle } from '../types/vehicle'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'
import { PageFill } from '../components/layout/PageFill'
import { VehicleCategoriesPanel } from './vehicles/VehicleCategoriesPanel'
import { VehicleFormDialog } from './vehicles/VehicleFormDialog'
import './vehicles/vehicles.css'

const STATUS_TONE: Record<Vehicle['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  maintenance: 'warning',
  inactive: 'neutral',
}

/**
 * The fleet register (ADR-0050).
 *
 * ## Two surfaces, one page
 *
 * The vehicles and the vocabulary they are described in sit behind a
 * segmented control rather than in two nav entries. A category is the
 * register's own vocabulary, it reads in context beside the vehicles using
 * it — the category list carries a live "4 vehicles" per row — and the nav
 * rail is long enough that the settings agent spent a whole change
 * shortening things. The owner was offered its own nav item and a home under
 * Settings, and chose this.
 *
 * ## What was here before
 *
 * A ninety-line read-only table. `VehicleController` has had `store`,
 * `update` and `destroy` since Phase 1 and **no screen had ever called
 * them**, so the fleet could only be grown by a seeder or, since ADR-0048,
 * sideways through the driver form.
 */
export function VehiclesPage() {
  const { user } = useAuth()
  const canManage = canManageFleet(user)

  const [surface, setSurface] = useState<'vehicles' | 'categories'>('vehicles')
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // '' is every category, which is what a fleet office wants on open.
  const [category, setCategory] = useState('')
  /**
   * Three states in one value: a `Vehicle` is an edit, `'new'` is a
   * registration, `null` is closed. A separate boolean beside an object is
   * the pair that can hold both and render two dialogs at once.
   */
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Vehicle | null>(null)

  /**
   * One categories fetch for the whole page.
   *
   * The table renders category *names*, the form offers them as choices, and
   * the panel manages them. Three fetches of the same nine rows would be
   * three requests the operator pays for to answer one question.
   */
  const { categories, error: categoriesError, reload: reloadCategories } = useVehicleCategories()

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<Vehicle[]>>('/vehicles')
        .then((response) => {
          setVehicles(response.data.data)
          setError(null)
        })
        .catch(() => setError('Could not load vehicles.')),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo<DataColumn<Vehicle>[]>(
    () => [
      { key: 'registration_number', card: 'title', header: 'Reg. number', sortable: true },
      { key: 'make', card: 'meta', header: 'Make' },
      { key: 'model', card: 'meta', header: 'Model' },
      { key: 'year', card: 'meta', header: 'Year', numeric: true, sortable: true },
      {
        key: 'category',
        card: 'meta',
        header: 'Category',
        // The office's own word for it, not the stored key — this cell used
        // to render `suv`. `categoryLabel` falls back to the key rather than
        // to a blank, so a category that was deleted still reads as
        // something rather than as missing data.
        render: (row) => <>{categoryLabel(categories, row.category)}</>,
      },
      { key: 'seating_capacity', card: 'meta', header: 'Seats', numeric: true },
      {
        key: 'status',
        card: 'status',
        header: 'Status',
        render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
      },
      {
        key: 'id',
        card: 'meta',
        header: '',
        render: (row) =>
          canManage ? (
            <span className="kr-categories__actions">
              <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDeleting(row)}>
                Delete
              </Button>
            </span>
          ) : null,
      },
    ],
    [categories, canManage],
  )

  const filtered = useMemo(() => {
    if (!vehicles) return []
    const q = query.trim().toLowerCase()

    // Category narrows first and text narrows within it, so "every boda" is
    // one choice rather than a word somebody has to know how to spell.
    const byCategory =
      category === '' ? vehicles : vehicles.filter((v) => v.category === category)

    if (!q) return byCategory

    return byCategory.filter(
      (v) =>
        v.registration_number.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q),
    )
  }, [vehicles, query, category])

  const showingVehicles = surface === 'vehicles'

  return (
    <PageFill>
      <PageFill.Flex>
        <Card
          fill
          title={showingVehicles ? 'Vehicles' : 'Vehicle categories'}
          subtitle={
            showingVehicles
              ? // A filtered table under "31 total" reads as a table that lost 30
                // rows. With a filter on, the count says what is on screen and
                // what it was cut from.
                vehicles
                ? filtered.length === vehicles.length
                  ? `${vehicles.length} total`
                  : `${filtered.length} of ${vehicles.length}`
                : undefined
              : 'What a rate card prices a vehicle as'
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
                gap: 'var(--space-3)',
                alignItems: 'center',
                // The filter gives way before the action does: on a narrow
                // screen "New vehicle" is what somebody came here to press.
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              {/*
                A radio group, not two buttons. The two options are one
                choice with one answer, which is what a screen reader is
                told here and what two <button>s would not say.
              */}
              <span className="kr-fleet-switch" role="radiogroup" aria-label="Fleet view">
                <Button
                  size="sm"
                  role="radio"
                  aria-checked={showingVehicles}
                  variant={showingVehicles ? 'primary' : 'ghost'}
                  onClick={() => setSurface('vehicles')}
                >
                  Vehicles
                </Button>
                <Button
                  size="sm"
                  role="radio"
                  aria-checked={!showingVehicles}
                  variant={showingVehicles ? 'ghost' : 'primary'}
                  onClick={() => setSurface('categories')}
                >
                  Categories
                </Button>
              </span>

              {showingVehicles && (
                <>
                  {/*
                    Before the text box, because it is the coarser cut: a fleet
                    office asks "what have we got in boda" far more often than
                    it looks for one plate.
                  */}
                  <Select
                    aria-label="Filter by category"
                    // The empty value is a real choice here, not an unfilled
                    // field: "All categories" is where the screen opens and
                    // where it goes back to.
                    placeholder="All categories"
                    options={categoryOptions(categories ?? [], category)}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{ width: 'min(190px, 100%)' }}
                  />
                  <Input
                    iconLeft="search"
                    placeholder="Filter by reg. number, make or model"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    // Takes what is left after the chooser and the action, rather
                    // than a fixed width that pushed "New driver" onto a second
                    // line. `minWidth: 0` because a flex item's default floor is
                    // its content.
                    style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 260 }}
                  />
                  {canManage && (
                    <Button iconLeft="plus" onClick={() => setEditing('new')}>
                      New vehicle
                    </Button>
                  )}
                </>
              )}
            </span>
          }
          padding="none"
        >
          {showingVehicles ? (
            error ? (
              <p style={{ padding: 'var(--space-6)', color: 'var(--kr-error)' }}>{error}</p>
            ) : (
              <DataTable<Vehicle>
                columns={columns}
                rows={filtered}
                fill
                emptyMessage={
                  vehicles === null
                    ? 'Loading…'
                    : query
                      ? 'No vehicles match your filter'
                      : canManage
                        ? 'No vehicles yet — use New vehicle to add the first one'
                        : 'No vehicles yet'
                }
              />
            )
          ) : (
            <VehicleCategoriesPanel
              categories={categories}
              error={categoriesError}
              canManage={canManage}
              onChanged={async () => {
                await reloadCategories()
                // A rename changes what the vehicles table renders, so the
                // other surface is refreshed too rather than left showing
                // the old word until somebody reloads the page.
                await load()
              }}
            />
          )}
        </Card>
      </PageFill.Flex>

      {editing !== null && (
        <VehicleFormDialog
          vehicle={editing === 'new' ? null : editing}
          categories={categories}
          categoriesError={categoriesError}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load()
            await reloadCategories()
            setEditing(null)
          }}
        />
      )}

      {deleting !== null && (
        <DeleteVehicleDialog
          vehicle={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            await load()
            await reloadCategories()
            setDeleting(null)
          }}
        />
      )}
    </PageFill>
  )
}

/**
 * Removing a vehicle from the fleet.
 *
 * Confirmed rather than immediate, and the copy says what actually happens:
 * `Vehicle` is soft-deleted, so the trips, invoices and allocations that
 * reference it keep resolving. Calling that "permanent" would be a lie in
 * the frightening direction; calling it nothing at all would leave a clerk
 * guessing whether they have just destroyed a year of trip history.
 */
function DeleteVehicleDialog({
  vehicle,
  onClose,
  onDeleted,
}: {
  vehicle: Vehicle
  onClose: () => void
  onDeleted: () => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    setMessage(null)

    try {
      await apiClient.delete(`/vehicles/${vehicle.id}`)
      onDeleted()
    } catch (failure) {
      setMessage(apiError(failure, 'Could not remove this vehicle.').message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      tone="destructive"
      title={`Remove ${vehicle.registration_number}?`}
      description="It leaves the fleet and stops being dispatchable. Past trips, invoices and allocations that name it are unaffected."
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void remove()}>
            Remove vehicle
          </Button>
        </>
      }
    >
      {message !== null && (
        <Alert tone="error" title="Not removed">
          {message}
        </Alert>
      )}
    </Dialog>
  )
}
