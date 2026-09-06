import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import { canManageFleet } from '../../lib/fleet'
import { categoryOptions, useVehicleCategories } from '../../lib/vehicleCategories'
import { useAuth } from '../../auth/useAuth'
import type { ApiSuccess } from '../../types/api'
import type { Driver } from '../../types/driver'
import type { Vehicle } from '../../types/vehicle'
import { Button } from '../../components/core/Button'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { Checkbox } from '../../components/forms/Checkbox'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Select } from '../../components/forms/Select'
import './driverForm.css'

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive', label: 'Inactive' },
]

/*
 * The hand-copied `CATEGORIES` list was here, and **it was wrong**: seven
 * entries, omitting `boda` and `tricycle` — on the form built precisely so a
 * rider arriving on their own boda could be onboarded, for a fleet that is
 * mostly boda riders. Nobody was careless; a mirrored list drifts, and this
 * one drifted within two days of being written.
 *
 * That is the finding ADR-0050 is built on. The categories now come from the
 * server, so this form and the fleet screen cannot come to disagree about
 * what a vehicle may be.
 */

/**
 * How the form is answering "what do they drive".
 *
 * Three states rather than a boolean, because "the vehicle already on file"
 * is genuinely different from both of the others: it is neither a choice being
 * made nor a record being created, and offering a clerk a fleet picker
 * pre-filled with the vehicle the driver already has invites them to change it
 * by accident.
 */
type VehicleMode = 'linked' | 'pick' | 'register'

interface VehicleDraft {
  registration_number: string
  make: string
  model: string
  year: string
  category: string
  seating_capacity: string
  color: string
  vin: string
}

const EMPTY_VEHICLE: VehicleDraft = {
  registration_number: '',
  make: '',
  model: '',
  year: '',
  // Blank, not 'sedan'. A preselected category is one a clerk has to notice
  // is wrong rather than one they have to give — and 'sedan' is the wrong
  // guess for the rider this section exists for.
  category: '',
  seating_capacity: '4',
  color: '',
  vin: '',
}

/**
 * Creating and editing a driver — **the screen this platform has never had**.
 *
 * `DriverController::store` and `update` have existed since Phase 1 and
 * nothing has ever called them: `DriversPage` was a read-only table, so every
 * driver in every environment arrived from a seeder. That is why ADR-0048 §8
 * describes this as a missing surface rather than a missing feature.
 *
 * ## The one decision worth reading
 *
 * The vehicle section is not a second form bolted on. It exists because the
 * fleet here is grown from riders who arrive on their own machine, and the
 * alternative the console offered was: leave this form, go to Vehicles,
 * register the boda, come back, and find what you typed gone. ADR-0048 §8
 * makes it one transaction on the server precisely so it can be one act here.
 *
 * ## Why a checkbox and not the Switch
 *
 * `Switch`'s own notes say it is for "a list of things that are on or off" —
 * a state to inspect — and answer the immediate-change objection by pointing
 * at a settings page's unsaved-changes bar. This is a form with a Save button,
 * which is the case `Checkbox` is for. Using a switch here would promise that
 * ticking it did something.
 */
export function DriverFormDialog({
  driver,
  onClose,
  onSaved,
}: {
  /** Null when creating. */
  driver: Driver | null
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const mayRegisterVehicle = canManageFleet(user)
  const editing = driver !== null

  const [name, setName] = useState(driver?.name ?? '')
  const [phone, setPhone] = useState(driver?.phone ?? '')
  const [email, setEmail] = useState(driver?.email ?? '')
  const [licenseNumber, setLicenseNumber] = useState(driver?.license_number ?? '')
  // `license_expiry` arrives as a date or an ISO instant depending on the
  // cast; `<input type="date">` accepts neither reliably, so it is trimmed to
  // the day here rather than at every read.
  const [licenseExpiry, setLicenseExpiry] = useState((driver?.license_expiry ?? '').slice(0, 10))
  const [status, setStatus] = useState(driver?.status ?? 'active')
  const [ownsVehicle, setOwnsVehicle] = useState(driver?.owns_vehicle ?? false)

  /**
   * **Registration is only ever offered to a driver marked as owning one.**
   *
   * This opened on `register` for every new driver, which put "Register their
   * vehicle" on screen above an unticked ownership box — a form inviting a
   * clerk to fill in eight fields the server then refuses with a 422, because
   * `ValidatesInlineVehicle` will not register a vehicle for a driver who does
   * not own one.
   *
   * Not caught by the component tests, every one of which ticked the box
   * first. Caught by opening the screen in a browser, which is why
   * `docs/screen-rules.md` §8 makes that a step rather than a suggestion.
   */
  const [mode, setMode] = useState<VehicleMode>(
    driver?.vehicle_id != null
      ? 'linked'
      : driver?.owns_vehicle && mayRegisterVehicle
        ? 'register'
        : 'pick',
  )
  const [vehicleId, setVehicleId] = useState(
    driver?.vehicle_id != null ? String(driver.vehicle_id) : '',
  )
  const [vehicle, setVehicle] = useState<VehicleDraft>(EMPTY_VEHICLE)

  const [fleet, setFleet] = useState<Vehicle[] | null>(null)
  // ADR-0050. The fleet's live vocabulary, replacing the seven-item literal
  // that used to sit at the top of this file and had already drifted.
  const { categories, error: categoriesError } = useVehicleCategories()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * The fleet, loaded only when a picker is actually going to be shown.
   *
   * A driver form opened to register somebody's own boda has no use for a list
   * of every vehicle the platform owns, and fetching it anyway is a request
   * the operator pays for on a screen that will not read it.
   */
  const needsFleet = mode === 'pick' || mode === 'linked'

  useEffect(() => {
    if (!needsFleet || fleet !== null) return

    apiClient
      .get<ApiSuccess<Vehicle[]>>('/vehicles')
      .then((response) => setFleet(response.data.data))
      .catch(() => setFleet([]))
  }, [needsFleet, fleet])

  const fleetOptions = useMemo(
    () =>
      (fleet ?? []).map((v) => ({
        value: String(v.id),
        label: `${v.registration_number} — ${v.make} ${v.model}`,
      })),
    [fleet],
  )

  const linked = useMemo(
    () => (fleet ?? []).find((v) => v.id === driver?.vehicle_id) ?? null,
    [fleet, driver],
  )

  /**
   * Ticking or clearing ownership moves the vehicle question, but never
   * silently discards an existing link.
   *
   * Un-ticking sets `owns_vehicle: false` and lets the server clear the link
   * (ADR-0048 §8) — **the vehicle itself survives**, and the copy under the
   * checkbox says so, because a clerk who thinks a tick-box deletes a fleet
   * record will not tick it.
   */
  const toggleOwnership = (next: boolean) => {
    setOwnsVehicle(next)

    // Ticking it offers the inline form, since a driver who owns a machine the
    // fleet has never seen is the case this whole section exists for.
    if (next && mode === 'pick' && driver?.vehicle_id == null && mayRegisterVehicle) {
      setMode('register')
      return
    }

    // Un-ticking withdraws it. Leaving a half-typed vehicle on screen under an
    // unticked box is a form whose two halves disagree, and the server settles
    // the disagreement with a 422 rather than a saved driver.
    if (!next && mode === 'register') {
      setMode('pick')
    }
  }

  const submit = async () => {
    setBusy(true)
    setErrors({})
    setProblem(null)

    // Only what this form actually decided. A PATCH that resends every field
    // is a PATCH that can overwrite a change somebody else made while this
    // dialog was open.
    const payload: Record<string, unknown> = {
      name,
      phone,
      email: email.trim() === '' ? null : email.trim(),
      license_number: licenseNumber,
      license_expiry: licenseExpiry,
      status,
      owns_vehicle: ownsVehicle,
    }

    if (mode === 'register') {
      payload.vehicle = {
        ...vehicle,
        year: Number(vehicle.year),
        seating_capacity: Number(vehicle.seating_capacity),
        color: vehicle.color.trim() === '' ? null : vehicle.color.trim(),
        vin: vehicle.vin.trim() === '' ? null : vehicle.vin.trim(),
      }
    } else {
      payload.vehicle_id = vehicleId === '' ? null : Number(vehicleId)
    }

    try {
      if (editing) {
        await apiClient.patch(`/drivers/${driver.id}`, payload)
      } else {
        await apiClient.post('/drivers', payload)
      }
      onSaved()
    } catch (error) {
      const failure = apiError(error, 'That could not be saved.')
      setErrors(fieldErrors(failure))
      // The banner carries what the fields cannot: a 403 on the fleet
      // permission, or a conflict that belongs to no single input.
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
      title={editing ? `Edit ${driver.name}` : 'New driver'}
      description={
        editing
          ? undefined
          : 'Their details and, if the vehicle is theirs, the vehicle — in one step.'
      }
      onClose={busy ? undefined : onClose}
      footer={
        <div className="kr-driver-form__footer">
          <span className="kr-driver-form__footer-spacer" />
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create driver'}
          </Button>
        </div>
      }
    >
      <div className="kr-driver-form">
        {problem !== null && <Alert tone="error">{problem}</Alert>}

        <fieldset className="kr-driver-form__section">
          <legend className="kr-driver-form__legend">Driver</legend>

          <div className="kr-driver-form__grid">
            <div className="kr-driver-form__wide">
              <FormField label="Full name" htmlFor="driver-name" required error={field('name')}>
                <Input
                  id="driver-name"
                  value={name}
                  autoComplete="off"
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Phone" htmlFor="driver-phone" required error={field('phone')}>
              <Input
                id="driver-phone"
                value={phone}
                inputMode="tel"
                /*
                  No pattern and no mask. PRODUCT.md forbids deepening the
                  Uganda assumption, and a `+256`-shaped mask is exactly that —
                  it would reject a Kenyan or Tanzanian number the day the
                  platform crosses a border.
                */
                placeholder="+256 772 123 456"
                onChange={(e) => setPhone(e.target.value)}
              />
            </FormField>

            <FormField
              label="Email"
              htmlFor="driver-email"
              hint="Optional. Needed only if they are given a sign-in."
              error={field('email')}
            >
              <Input
                id="driver-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>

            <FormField
              label="Licence number"
              htmlFor="driver-licence"
              required
              error={field('license_number')}
            >
              <Input
                id="driver-licence"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
              />
            </FormField>

            <FormField
              label="Licence expiry"
              htmlFor="driver-expiry"
              required
              error={field('license_expiry')}
            >
              <Input
                id="driver-expiry"
                type="date"
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
              />
            </FormField>

            <FormField label="Status" htmlFor="driver-status" error={field('status')}>
              <Select
                id="driver-status"
                value={status}
                options={STATUSES}
                onChange={(e) => setStatus(e.target.value as Driver['status'])}
              />
            </FormField>
          </div>
        </fieldset>

        <fieldset className="kr-driver-form__section">
          <legend className="kr-driver-form__legend">Vehicle</legend>

          <Checkbox
            checked={ownsVehicle}
            label="This driver owns their vehicle"
            hint={
              ownsVehicle
                ? 'Their own machine — it stays with them. Registering it here adds it to the fleet.'
                : 'Leave unticked for a driver who takes whatever the depot allocates that shift.'
            }
            onChange={(e) => toggleOwnership(e.target.checked)}
          />
          {field('owns_vehicle') !== undefined && (
            <Alert tone="error">{field('owns_vehicle')}</Alert>
          )}

          {mode === 'linked' && (
            <div className="kr-driver-form__vehicle">
              <div className="kr-driver-form__linked">
                <div>
                  <div className="kr-driver-form__plate">
                    {linked?.registration_number ?? `Vehicle #${driver?.vehicle_id ?? ''}`}
                  </div>
                  {linked !== null && (
                    <div className="kr-driver-form__linked-meta">
                      {linked.make} {linked.model} · {linked.year}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="secondary" onClick={() => setMode('pick')}>
                  Change
                </Button>
              </div>
            </div>
          )}

          {mode === 'pick' && (
            <div className="kr-driver-form__vehicle">
              <div className="kr-driver-form__vehicle-head">
                <span className="kr-driver-form__vehicle-title">From the fleet</span>
                {mayRegisterVehicle && (
                  <Button size="sm" variant="ghost" onClick={() => setMode('register')}>
                    Register a new one
                  </Button>
                )}
              </div>

              <FormField
                label="Vehicle"
                labelHidden
                htmlFor="driver-vehicle"
                hint={
                  mayRegisterVehicle
                    ? undefined
                    : 'Registering a vehicle needs the fleet permission, which this account does not have.'
                }
                error={field('vehicle_id')}
              >
                <Select
                  id="driver-vehicle"
                  value={vehicleId}
                  placeholder={fleet === null ? 'Loading the fleet…' : 'No vehicle'}
                  options={fleetOptions}
                  onChange={(e) => setVehicleId(e.target.value)}
                />
              </FormField>
            </div>
          )}

          {mode === 'register' && (
            <div className="kr-driver-form__vehicle">
              <div className="kr-driver-form__vehicle-head">
                <span className="kr-driver-form__vehicle-title">Register their vehicle</span>
                <Button size="sm" variant="ghost" onClick={() => setMode('pick')}>
                  Pick from the fleet instead
                </Button>
              </div>

              {field('vehicle') !== undefined && <Alert tone="error">{field('vehicle')}</Alert>}

              <div className="kr-driver-form__grid">
                <FormField
                  label="Number plate"
                  htmlFor="v-plate"
                  required
                  error={field('vehicle.registration_number')}
                >
                  <Input
                    id="v-plate"
                    value={vehicle.registration_number}
                    /*
                      Uppercased on the way in, because a plate is read back
                      against a vehicle in a yard and "uax 123x" is a different
                      string to the index even though it is the same car.
                    */
                    onChange={(e) =>
                      setVehicle({ ...vehicle, registration_number: e.target.value.toUpperCase() })
                    }
                  />
                </FormField>

                <FormField
                  label="Category"
                  htmlFor="v-category"
                  required
                  error={field('vehicle.category')}
                >
                  <Select
                    id="v-category"
                    value={vehicle.category}
                    disabled={categories === null || categoriesError !== null}
                    placeholder={categories === null ? 'Loading…' : 'Choose a category'}
                    options={categoryOptions(categories ?? [])}
                    onChange={(e) => setVehicle({ ...vehicle, category: e.target.value })}
                  />
                </FormField>

                <FormField label="Make" htmlFor="v-make" required error={field('vehicle.make')}>
                  <Input
                    id="v-make"
                    value={vehicle.make}
                    onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })}
                  />
                </FormField>

                <FormField label="Model" htmlFor="v-model" required error={field('vehicle.model')}>
                  <Input
                    id="v-model"
                    value={vehicle.model}
                    onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })}
                  />
                </FormField>

                <FormField label="Year" htmlFor="v-year" required error={field('vehicle.year')}>
                  <Input
                    id="v-year"
                    type="number"
                    inputMode="numeric"
                    value={vehicle.year}
                    onChange={(e) => setVehicle({ ...vehicle, year: e.target.value })}
                  />
                </FormField>

                <FormField
                  label="Seats"
                  htmlFor="v-seats"
                  required
                  error={field('vehicle.seating_capacity')}
                >
                  <Input
                    id="v-seats"
                    type="number"
                    inputMode="numeric"
                    value={vehicle.seating_capacity}
                    onChange={(e) => setVehicle({ ...vehicle, seating_capacity: e.target.value })}
                  />
                </FormField>

                <FormField label="Colour" htmlFor="v-colour" error={field('vehicle.color')}>
                  <Input
                    id="v-colour"
                    value={vehicle.color}
                    onChange={(e) => setVehicle({ ...vehicle, color: e.target.value })}
                  />
                </FormField>

                <FormField
                  label="VIN"
                  htmlFor="v-vin"
                  hint="Optional."
                  error={field('vehicle.vin')}
                >
                  <Input
                    id="v-vin"
                    value={vehicle.vin}
                    onChange={(e) => setVehicle({ ...vehicle, vin: e.target.value })}
                  />
                </FormField>
              </div>
            </div>
          )}
        </fieldset>
      </div>
    </Dialog>
  )
}
