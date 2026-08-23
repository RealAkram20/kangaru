import { useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { categoryOptions } from '../../lib/vehicleCategories'
import type { Vehicle } from '../../types/vehicle'
import type { VehicleCategory } from '../../types/vehicleCategory'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'
import './vehicles.css'

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'maintenance', label: 'In maintenance' },
  { value: 'inactive', label: 'Inactive' },
]

/**
 * Registering and editing a fleet vehicle — **the screen this platform has
 * never had** (ADR-0050).
 *
 * `VehicleController::store`, `update` and `destroy` have existed since Phase
 * 1, with a policy, form requests and a service, and nothing has ever called
 * them: `VehiclesPage` was a ninety-line read-only table. Every vehicle in
 * every environment arrived from a seeder or, since ADR-0048, sideways
 * through the driver form. That is the same finding ADR-0048 made about
 * drivers, one page along in the same directory.
 *
 * ## The categories come from the server, and there is no fallback
 *
 * `useVehicleCategories` in `lib/vehicleCategories.ts` explains why at
 * length. The short version: the office can retire a category, so a
 * hard-coded list offers choices the server refuses — and a hard-coded list
 * is what this change exists to remove. If the categories could not be
 * loaded, the select is disabled and says so.
 *
 * ## Why the category select shows a retired option on an edit
 *
 * `categoryOptions(categories, vehicle.category)` keeps the vehicle's own
 * category in the list even after the office retires it, matching the
 * server's `ActiveVehicleCategory($alsoAllow)` exactly. Dropping it would be
 * worse than it sounds: a `<select>` whose `value` matches no option renders
 * as the **first** option, so a clerk opening a retired tricycle to fix its
 * colour would see "Boda", and saving would write it.
 */
export function VehicleFormDialog({
  vehicle,
  categories,
  categoriesError,
  onClose,
  onSaved,
}: {
  /** Null when registering a new vehicle. */
  vehicle: Vehicle | null
  /** Null while still loading. Lifted from the page so both surfaces share one fetch. */
  categories: VehicleCategory[] | null
  categoriesError: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = vehicle !== null

  const [registration, setRegistration] = useState(vehicle?.registration_number ?? '')
  const [make, setMake] = useState(vehicle?.make ?? '')
  const [model, setModel] = useState(vehicle?.model ?? '')
  const [year, setYear] = useState(vehicle === null ? '' : String(vehicle.year))
  const [category, setCategory] = useState(vehicle?.category ?? '')
  const [seats, setSeats] = useState(vehicle === null ? '' : String(vehicle.seating_capacity))
  const [color, setColor] = useState(vehicle?.color ?? '')
  const [vin, setVin] = useState(vehicle?.vin ?? '')
  const [status, setStatus] = useState<Vehicle['status']>(vehicle?.status ?? 'active')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const options = categoryOptions(categories ?? [], vehicle?.category)

  /**
   * Nothing is preselected on a new vehicle.
   *
   * Defaulting to the first category would make "Boda" the answer a clerk
   * has to notice is wrong, rather than one they have to give. The empty
   * option below is what makes the field's `required` mean anything.
   */
  const incomplete =
    registration.trim() === '' ||
    make.trim() === '' ||
    model.trim() === '' ||
    year.trim() === '' ||
    category === '' ||
    seats.trim() === ''

  const submit = async () => {
    setBusy(true)
    setErrors({})
    setProblem(null)

    const payload = {
      registration_number: registration.trim(),
      make: make.trim(),
      model: model.trim(),
      year: Number(year),
      category,
      seating_capacity: Number(seats),
      // Empty means "not recorded", which is a different claim from an empty
      // string, and it is what the column stores.
      color: color.trim() === '' ? null : color.trim(),
      vin: vin.trim() === '' ? null : vin.trim(),
      status,
    }

    try {
      if (editing) {
        await apiClient.patch(`/vehicles/${vehicle.id}`, payload)
      } else {
        await apiClient.post('/vehicles', payload)
      }
      onSaved()
    } catch (error) {
      const failure = apiError(error, 'That could not be saved.')
      setErrors(fieldErrors(failure))
      // The banner carries what no single field can: a 403 on
      // `vehicles.manage`, or a conflict belonging to the request as a whole.
      setProblem(Object.keys(failure.errors).length === 0 ? failure.message : null)
    } finally {
      setBusy(false)
    }
  }

  const field = (key: string) => errors[key]

  return (
    <Dialog
      open
      width={640}
      title={editing ? `Edit ${vehicle.registration_number}` : 'New vehicle'}
      description={
        editing
          ? undefined
          : 'One record per physical vehicle. The plate is unique across the fleet.'
      }
      onClose={busy ? undefined : onClose}
      footer={
        <div className="kr-vehicle-form__footer">
          <span className="kr-vehicle-form__footer-spacer" />
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || incomplete}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Register vehicle'}
          </Button>
        </div>
      }
    >
      <div className="kr-vehicle-form">
        {problem !== null && <Alert tone="error">{problem}</Alert>}

        {categoriesError !== null && (
          <Alert tone="error" title="Categories unavailable">
            {categoriesError} A vehicle cannot be saved without one — reload the page and try again.
          </Alert>
        )}

        <div className="kr-vehicle-form__grid">
          <div className="kr-vehicle-form__wide">
            <FormField
              label="Registration number"
              htmlFor="vehicle-plate"
              required
              hint="Unique across the whole fleet."
              error={field('registration_number')}
            >
              <Input
                id="vehicle-plate"
                value={registration}
                autoComplete="off"
                /*
                  No mask and no pattern. `PRODUCT.md` forbids deepening the
                  Uganda assumption, and a `UAA 000A`-shaped mask is exactly
                  that — it would refuse a Kenyan plate the day the platform
                  crosses a border.
                */
                placeholder="UAA 123A"
                onChange={(e) => setRegistration(e.target.value)}
              />
            </FormField>
          </div>

          <FormField label="Make" htmlFor="vehicle-make" required error={field('make')}>
            <Input id="vehicle-make" value={make} onChange={(e) => setMake(e.target.value)} />
          </FormField>

          <FormField label="Model" htmlFor="vehicle-model" required error={field('model')}>
            <Input id="vehicle-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </FormField>

          <FormField label="Year" htmlFor="vehicle-year" required error={field('year')}>
            <Input
              id="vehicle-year"
              type="number"
              min={1980}
              max={new Date().getFullYear() + 1}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </FormField>

          <FormField
            label="Category"
            htmlFor="vehicle-category"
            required
            hint="What a rate card prices this vehicle as."
            error={field('category')}
          >
            <Select
              id="vehicle-category"
              value={category}
              // Loading is not the same as "no categories": disabling until
              // the list settles stops a clerk choosing from an empty select
              // and being told the field is required.
              disabled={categories === null || categoriesError !== null}
              placeholder={categories === null ? 'Loading…' : 'Choose a category'}
              options={options}
              onChange={(e) => setCategory(e.target.value)}
            />
          </FormField>

          <FormField
            label="Seats"
            htmlFor="vehicle-seats"
            required
            error={field('seating_capacity')}
          >
            <Input
              id="vehicle-seats"
              type="number"
              min={1}
              max={100}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
            />
          </FormField>

          <FormField label="Status" htmlFor="vehicle-status" error={field('status')}>
            <Select
              id="vehicle-status"
              value={status}
              options={STATUSES}
              onChange={(e) => setStatus(e.target.value as Vehicle['status'])}
            />
          </FormField>

          <FormField label="Colour" htmlFor="vehicle-color" error={field('color')}>
            <Input id="vehicle-color" value={color} onChange={(e) => setColor(e.target.value)} />
          </FormField>

          <FormField
            label="VIN"
            htmlFor="vehicle-vin"
            hint="Optional. The chassis number on the logbook."
            error={field('vin')}
          >
            <Input id="vehicle-vin" value={vin} onChange={(e) => setVin(e.target.value)} />
          </FormField>
        </div>
      </div>
    </Dialog>
  )
}
