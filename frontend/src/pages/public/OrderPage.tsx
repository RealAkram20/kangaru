import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Car,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  History,
  KeyRound,
  LocateFixed,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Search,
  User,
  Users,
  Weight,
} from 'lucide-react'
import { isAxiosError } from 'axios'
import {
  SERVICE_META,
  submitPublicOrder,
  type PublicOrderPayload,
  type PublicService,
} from './publicOrder'
import {
  placeLabel,
  recentDestinations,
  rememberDestination,
  reverseGeocode,
  searchPlaces,
  type PlaceHit,
} from './places'
import { DateRangePicker } from './DateRangePicker'
import './landing.css'

type Step = 'service' | 'details' | 'vehicle' | 'contact' | 'review'

/**
 * The vehicle IS the product. Delivery leads with it (the size defaults and
 * is changeable right there); rides and rentals need the trip or the dates
 * first, so their vehicle step follows the details.
 */
function stepsFor(service: PublicService): Step[] {
  return service === 'delivery'
    ? ['service', 'vehicle', 'details', 'contact', 'review']
    : ['service', 'details', 'vehicle', 'contact', 'review']
}

/**
 * The ride classes on offer, with the same starting fares the landing page
 * advertises. No live ETAs or discounts: the dispatcher quotes the real
 * price on the confirmation call.
 */
const RIDE_CLASSES = [
  { value: 'economy', label: 'Economy', seats: 4, fare: 'UGX 12,500', sprite: 'side-economy' },
  { value: 'standard', label: 'Standard', seats: 4, fare: 'UGX 16,500', sprite: 'side-standard' },
  { value: 'xl', label: 'XL', seats: 6, fare: 'UGX 22,000', sprite: 'side-xl' },
  { value: 'boda', label: 'Boda Boda', seats: 1, fare: 'UGX 5,000', sprite: 'side-boda' },
  {
    value: 'electric_boda',
    label: 'Electric Boda',
    seats: 1,
    fare: 'UGX 6,000',
    sprite: 'side-electric-boda',
  },
]

/**
 * Delivery is vehicle-first: instead of interrogating the sender about the
 * item, the package size recommends a vehicle and the price says the rest.
 */
const DELIVERY_FLEET: {
  id: string
  name: string
  blurb: string
  fare: string
  sprite: string
  forSize: string
}[] = [
  {
    id: 'boda',
    name: 'Boda Boda',
    blurb: 'Best for small items & documents',
    fare: 'UGX 5,000',
    sprite: 'side-boda',
    forSize: 'small',
  },
  {
    id: 'tricycle',
    name: 'Tricycle',
    blurb: 'For medium packages',
    fare: 'UGX 9,000',
    sprite: 'side-tricycle',
    forSize: 'medium',
  },
  {
    id: 'pickup',
    name: 'Pickup',
    blurb: 'For large packages',
    fare: 'UGX 18,000',
    sprite: 'side-pickup',
    forSize: 'large',
  },
  {
    id: '5ton',
    name: '5 Ton',
    blurb: 'For heavy cargo',
    fare: 'UGX 65,000',
    sprite: 'side-truck',
    forSize: 'heavy',
  },
  {
    id: '10ton',
    name: '10 Ton',
    blurb: 'For very heavy cargo',
    fare: 'UGX 110,000',
    sprite: 'side-truck',
    forSize: '',
  },
]

const PACKAGE_SIZES = [
  { value: 'small', label: 'Small (under 5 kg)' },
  { value: 'medium', label: 'Medium (5 to 20 kg)' },
  { value: 'large', label: 'Large (over 20 kg)' },
  { value: 'heavy', label: 'Heavy cargo' },
]

type RentalCategory = 'sedan' | 'suv' | 'van' | 'pickup'

/**
 * The self-drive catalogue. A hand-kept list for now - the public API has no
 * fleet endpoint - with indicative day rates; the dispatcher confirms
 * availability and the final rate on the call.
 */
const SELF_DRIVE_FLEET: {
  id: string
  name: string
  category: RentalCategory
  transmission: string
  seats: number
  rate: string
  sprite: string
}[] = [
  {
    id: 'premio',
    name: 'Toyota Premio',
    category: 'sedan',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 180,000',
    sprite: 'side-economy',
  },
  {
    id: 'allion',
    name: 'Toyota Allion',
    category: 'sedan',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 160,000',
    sprite: 'side-economy',
  },
  {
    id: 'forester',
    name: 'Subaru Forester',
    category: 'suv',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 250,000',
    sprite: 'side-standard',
  },
  {
    id: 'rav4',
    name: 'Toyota RAV4',
    category: 'suv',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 230,000',
    sprite: 'side-standard',
  },
  {
    id: 'noah',
    name: 'Toyota Noah',
    category: 'van',
    transmission: 'Automatic',
    seats: 8,
    rate: 'UGX 280,000',
    sprite: 'side-xl',
  },
  {
    id: 'hiace',
    name: 'Toyota Hiace',
    category: 'van',
    transmission: 'Manual',
    seats: 14,
    rate: 'UGX 350,000',
    sprite: 'side-xl',
  },
  {
    id: 'hilux',
    name: 'Toyota Hilux',
    category: 'pickup',
    transmission: 'Manual',
    seats: 5,
    rate: 'UGX 400,000',
    sprite: 'side-pickup',
  },
]

const RENTAL_FILTERS: { value: RentalCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'van', label: 'Vans' },
  { value: 'pickup', label: 'Pickup' },
]

/**
 * The visitor order flow (ADR-0012 §5): service, details, contact, review,
 * then the reference the dispatcher will quote back. State lives here and
 * flows down; the only network call is the final submit.
 */
export function OrderPage() {
  const [params] = useSearchParams()

  const initialService = ((): PublicService => {
    const fromUrl = params.get('service')
    return fromUrl === 'delivery' || fromUrl === 'self_drive' ? fromUrl : 'ride'
  })()

  const [step, setStep] = useState<Step>(() => {
    const fromUrl = params.get('service')
    if (fromUrl === 'delivery') return 'vehicle'
    return fromUrl ? 'details' : 'service'
  })
  const [service, setService] = useState<PublicService>(initialService)
  const [pickup, setPickup] = useState(params.get('pickup') ?? '')
  const [dropoff, setDropoff] = useState(params.get('dropoff') ?? '')
  const [rideFor, setRideFor] = useState<'myself' | 'other'>('myself')
  const [riderName, setRiderName] = useState('')
  const [riderPhone, setRiderPhone] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [vehicleClass, setVehicleClass] = useState('economy')
  const [packageSize, setPackageSize] = useState('medium')
  const [sizeOpen, setSizeOpen] = useState(false)
  const [deliveryVehicle, setDeliveryVehicle] = useState<string | null>(null)
  // The recommendation IS the selection until the sender overrides it, so
  // walking straight onto the vehicle screen still has a sensible pick.
  const effectiveDeliveryVehicle =
    deliveryVehicle ?? DELIVERY_FLEET.find((v) => v.forSize === packageSize)?.id ?? null
  const [rentalModel, setRentalModel] = useState<string | null>(null)
  const [rentalFilter, setRentalFilter] = useState<RentalCategory | 'all'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [honeypot, setHoneypot] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [reference, setReference] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)

  const steps = stepsFor(service)
  const stepIndex = steps.indexOf(step)

  // Picking a vehicle happens mid-list, with Continue often below the fold;
  // bring it into view so the next tap is obvious.
  const continueRef = useRef<HTMLDivElement>(null)
  const revealContinue = () => {
    requestAnimationFrame(() => {
      const el = continueRef.current
      if (el !== null && typeof el.scrollIntoView === 'function') {
        const reduceMotion =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
      }
    })
  }

  const detailsValid = useMemo(() => {
    if (service === 'self_drive') return startDate !== '' && endDate !== ''
    const trip = pickup.trim() !== '' && dropoff.trim() !== ''
    // A ride for someone else needs the rider reachable by the dispatcher.
    if (service === 'ride' && rideFor === 'other') {
      return trip && riderName.trim() !== '' && riderPhone.trim().length >= 9
    }
    return trip
  }, [service, pickup, dropoff, startDate, endDate, rideFor, riderName, riderPhone])

  // No account, no password (ADR-0012 §3): this flow collects only what
  // the dispatcher needs to make the phone call. Customer accounts are a
  // deferred decision — collecting a credential before the endpoint that
  // could honour it exists would be pretending, and a stored-nowhere
  // password is a secret people reuse. Email is optional, as the server
  // says it is.
  const contactValid = contactName.trim() !== '' && contactPhone.trim().length >= 9

  const buildPayload = (): PublicOrderPayload => {
    const details: Record<string, string | number> = {}
    if (service === 'ride') {
      // The dispatcher settles the headcount on the phone.
      details.passengers = 1
      details.vehicle_class = vehicleClass
      // A ride for someone else: the rider is the recipient of the service,
      // so it rides on the same validated details keys delivery uses.
      if (rideFor === 'other') {
        if (riderName.trim()) details.recipient_name = riderName.trim()
        if (riderPhone.trim()) details.recipient_phone = riderPhone.trim()
      }
    }
    if (service === 'delivery') {
      details.package_size = packageSize
      const vehicle = DELIVERY_FLEET.find((v) => v.id === effectiveDeliveryVehicle)
      if (vehicle !== undefined) details.delivery_vehicle = vehicle.name
    }
    if (service === 'self_drive') {
      const model = SELF_DRIVE_FLEET.find((m) => m.id === rentalModel)
      if (model !== undefined) {
        details.vehicle_category = model.category
        details.vehicle_model = model.name
      }
      details.start_date = startDate
      details.end_date = endDate
    }

    return {
      service_type: service,
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim(),
      contact_email: contactEmail.trim() || undefined,
      pickup_location: service === 'self_drive' ? undefined : pickup.trim(),
      dropoff_location: service === 'self_drive' ? undefined : dropoff.trim(),
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      notes: notes.trim() || undefined,
      details,
      website: honeypot || undefined,
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setFailure(null)
    setServerErrors({})
    try {
      setReference(await submitPublicOrder(buildPayload()))
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 422) {
        const raw: Record<string, string[]> = error.response.data.errors ?? {}
        setServerErrors(
          Object.fromEntries(Object.entries(raw).map(([key, messages]) => [key, messages[0]])),
        )
        // The offending field lives on an earlier step; go back to it.
        setStep(Object.keys(raw).some((k) => k.startsWith('contact')) ? 'contact' : 'details')
      } else if (isAxiosError(error) && error.response?.status === 429) {
        setFailure('Too many orders from this connection. Please wait a minute and try again.')
      } else {
        setFailure('Something went wrong sending your order. Please try again, or call us.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (reference !== null) {
    return <SuccessScreen reference={reference} />
  }

  return (
    <div className="min-h-[100dvh] bg-surface-page text-text-body">
      <OrderNav />
      {/* Two arrangements of the same DOM. Mobile is the app mockup: the map
          fills the screen, the header floats, and the form lives in a bottom
          sheet. From lg up it becomes the Uber split: form column on the
          left, map owning the rest of the viewport. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,34rem)_1fr]">
        <main className="kr-sheet fixed inset-x-0 bottom-0 z-30 max-h-[78dvh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-surface-card px-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,16,40,0.16)] lg:static lg:z-auto lg:max-h-none lg:max-w-none lg:animate-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:px-10 lg:pb-20 lg:pt-8 lg:shadow-none lg:[transform:none]">
          {/* The sheet's grab handle, purely visual on the web. */}
          <div
            className="mx-auto mb-4 mt-3 h-1 w-10 rounded-full bg-border lg:hidden"
            aria-hidden
          />
          {/* The home sheet reads as a menu, not a wizard: the progress rail
              only appears once a service has been picked. */}
          <ol
            className={`items-center gap-2 ${step === 'service' ? 'hidden lg:flex' : 'flex'}`}
            aria-label="Progress"
          >
            {steps.map((s, i) => (
              <li
                key={s}
                aria-current={s === step ? 'step' : undefined}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= stepIndex ? 'bg-brand-green' : 'bg-surface-sunken'
                }`}
              />
            ))}
          </ol>

          {failure !== null && (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {failure}
            </p>
          )}

          {step === 'service' && (
            <StepShell title="What would you like to do?" centerTitle>
              {/* The app mockup's home sheet: three upright cards in a row,
                  icon above a green label above a two-line description. */}
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(SERVICE_META) as PublicService[]).map((key) => {
                  const icons: Record<PublicService, React.ReactNode> = {
                    ride: <Car className="h-7 w-7" aria-hidden />,
                    delivery: <Package className="h-7 w-7" aria-hidden />,
                    self_drive: <KeyRound className="h-7 w-7" aria-hidden />,
                  }
                  const tints: Record<PublicService, string> = {
                    ride: 'bg-brand-green-tint',
                    delivery: 'bg-surface-accent',
                    self_drive: 'bg-surface-sunken',
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setService(key)
                        setStep(key === 'delivery' ? 'vehicle' : 'details')
                      }}
                      className={`flex flex-col items-center gap-3 rounded-2xl border border-transparent px-3 py-6 text-center transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98] ${tints[key]}`}
                    >
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-card text-brand-green shadow-sm">
                        {icons[key]}
                      </span>
                      <span className="font-display font-semibold text-brand-green">
                        {SERVICE_META[key].label}
                      </span>
                      <span className="text-xs leading-relaxed text-text-secondary">
                        {SERVICE_META[key].short}
                      </span>
                    </button>
                  )
                })}
              </div>
            </StepShell>
          )}

          {step === 'details' && (
            <StepShell
              title={
                service === 'ride'
                  ? 'Where are you going?'
                  : service === 'delivery'
                    ? 'Where is it going?'
                    : 'Your rental'
              }
              onBack={() => setStep(service === 'delivery' ? 'vehicle' : 'service')}
            >
              {/* Uber's form language: the field name lives in the row as an
                  icon and a placeholder, not a label above. Labels stay in the
                  DOM (sr-only) for screen readers and the tests. */}
              <div className="space-y-3">
                {service === 'ride' && (
                  <>
                    <RidePickupCard
                      pickup={pickup}
                      onPickupChange={setPickup}
                      rideFor={rideFor}
                      onRideForChange={setRideFor}
                      riderName={riderName}
                      onRiderNameChange={setRiderName}
                      riderPhone={riderPhone}
                      onRiderPhoneChange={setRiderPhone}
                      error={serverErrors.pickup_location}
                    />
                    <DestinationSearch
                      value={dropoff}
                      onChange={setDropoff}
                      error={serverErrors.dropoff_location}
                      onHistoryPick={() => {
                        // A history pick is a known destination - jump ahead,
                        // as long as the rest of the step is already complete.
                        const riderReady =
                          rideFor === 'myself' ||
                          (riderName.trim() !== '' && riderPhone.trim().length >= 9)
                        if (pickup.trim() !== '' && riderReady) setStep('vehicle')
                      }}
                    />
                  </>
                )}

                {service === 'delivery' && (
                  <>
                    <IconField
                      icon={<CircleDot className="h-4 w-4 text-brand-green" />}
                      label="Pickup location"
                      value={pickup}
                      onChange={setPickup}
                      error={serverErrors.pickup_location}
                      placeholder="Pickup location"
                    />
                    <IconField
                      icon={<MapPin className="h-4 w-4 text-text-secondary" />}
                      label="Drop-off location"
                      value={dropoff}
                      onChange={setDropoff}
                      error={serverErrors.dropoff_location}
                      placeholder="Drop-off location"
                    />
                  </>
                )}

                {service === 'delivery' && (
                  <>
                    <IconField
                      icon={<Clock className="h-4 w-4 text-text-secondary" />}
                      label="When"
                      value={scheduledFor}
                      onChange={setScheduledFor}
                      type="datetime-local"
                      error={serverErrors.scheduled_for}
                      hint="Leave empty to send it as soon as possible."
                    />
                  </>
                )}

                {service === 'self_drive' && (
                  <>
                    <DateRangePicker
                      start={startDate}
                      end={endDate}
                      onChange={(nextStart, nextEnd) => {
                        setStartDate(nextStart)
                        setEndDate(nextEnd)
                      }}
                    />
                    {(serverErrors['details.start_date'] !== undefined ||
                      serverErrors['details.end_date'] !== undefined) && (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {serverErrors['details.start_date'] ?? serverErrors['details.end_date']}
                      </p>
                    )}
                  </>
                )}
              </div>
              <NextButton
                disabled={!detailsValid}
                onClick={() => setStep(service === 'delivery' ? 'contact' : 'vehicle')}
              />
            </StepShell>
          )}

          {step === 'vehicle' && service === 'delivery' && (
            <StepShell title="Choose a vehicle" onBack={() => setStep('service')}>
              {/* The size → vehicle bridge, with an escape hatch back to it. */}
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-surface-sunken px-4 py-3 text-sm">
                <p className="text-text-secondary">
                  Based on your package size:{' '}
                  {(() => {
                    const label =
                      PACKAGE_SIZES.find((s) => s.value === packageSize)?.label ?? packageSize
                    const [name, ...rest] = label.split(' (')
                    return (
                      <>
                        <span className="font-semibold text-brand-green">{name}</span>
                        {rest.length > 0 && <span> ({rest.join(' (')}</span>}
                      </>
                    )
                  })()}
                </p>
                <button
                  type="button"
                  aria-expanded={sizeOpen}
                  onClick={() => setSizeOpen((open) => !open)}
                  className="shrink-0 font-semibold text-brand-green transition-colors hover:text-brand-green-hover"
                >
                  Change
                </button>
              </div>
              {sizeOpen && (
                <div className="kr-rise mb-4">
                  <IconSelect
                    icon={<Weight className="h-4 w-4 text-text-secondary" />}
                    label="Package size"
                    value={packageSize}
                    onChange={(value) => {
                      setPackageSize(value)
                      // The recommendation follows the size until overridden.
                      setDeliveryVehicle(null)
                    }}
                    options={PACKAGE_SIZES}
                  />
                </div>
              )}

              <div role="radiogroup" aria-label="Vehicle" className="space-y-3">
                {DELIVERY_FLEET.map((vehicle) => {
                  const selected = effectiveDeliveryVehicle === vehicle.id
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setDeliveryVehicle(vehicle.id)
                        revealContinue()
                      }}
                      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 ease-out active:scale-[0.99] ${
                        selected
                          ? 'border-brand-green bg-surface-accent'
                          : 'border-border bg-surface-card'
                      }`}
                    >
                      <img
                        src={`/assets/vehicles/${vehicle.sprite}.svg`}
                        alt=""
                        className="h-12 w-20 shrink-0 object-contain"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block whitespace-nowrap font-display font-semibold text-text-heading">
                          {vehicle.name}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-text-secondary">
                          {vehicle.blurb}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-text-heading">
                        {vehicle.fare}
                      </span>
                      {selected ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-green" aria-hidden />
                      ) : (
                        <span className="h-5 w-5 shrink-0" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Prices are starting fares. The dispatcher confirms the exact price on the call.
              </p>
              <div ref={continueRef}>
                <NextButton
                  disabled={effectiveDeliveryVehicle === null}
                  onClick={() => setStep('details')}
                />
              </div>
            </StepShell>
          )}

          {step === 'vehicle' && service === 'self_drive' && (
            <StepShell title="Pick a vehicle for your trip" onBack={() => setStep('details')}>
              {/* Category chips, as in the app mockup. */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {RENTAL_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={rentalFilter === filter.value}
                    onClick={() => setRentalFilter(filter.value)}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out ${
                      rentalFilter === filter.value
                        ? 'bg-brand-green text-text-on-brand'
                        : 'bg-surface-sunken text-text-secondary hover:text-text-heading'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div role="radiogroup" aria-label="Vehicle" className="mt-4 space-y-3">
                {SELF_DRIVE_FLEET.filter(
                  (m) => rentalFilter === 'all' || m.category === rentalFilter,
                ).map((model) => {
                  const selected = rentalModel === model.id
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setRentalModel(model.id)
                        revealContinue()
                      }}
                      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 ease-out active:scale-[0.99] ${
                        selected
                          ? 'border-brand-green bg-surface-accent'
                          : 'border-border bg-surface-card'
                      }`}
                    >
                      <img
                        src={`/assets/vehicles/${model.sprite}.svg`}
                        alt=""
                        className="h-16 w-28 shrink-0 object-contain"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display font-semibold text-text-heading">
                          {model.name}
                        </span>
                        <span className="mt-0.5 block text-sm text-text-secondary">
                          {model.transmission} · {model.seats} seats
                        </span>
                        <span className="mt-1 block font-semibold text-brand-green">
                          {model.rate} / day
                        </span>
                      </span>
                      {selected ? (
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-green" aria-hidden />
                      ) : (
                        <span className="h-6 w-6 shrink-0" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Day rates are indicative. The dispatcher confirms availability and the final rate.
              </p>
              <div ref={continueRef}>
                <NextButton disabled={rentalModel === null} onClick={() => setStep('contact')} />
              </div>
            </StepShell>
          )}

          {step === 'vehicle' && service === 'ride' && (
            <StepShell title="Choose a ride" onBack={() => setStep('details')}>
              <div role="radiogroup" aria-label="Vehicle" className="space-y-3">
                {RIDE_CLASSES.map((klass) => {
                  const selected = vehicleClass === klass.value
                  return (
                    <button
                      key={klass.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setVehicleClass(klass.value)
                        revealContinue()
                      }}
                      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 ease-out active:scale-[0.99] ${
                        selected
                          ? 'border-brand-green bg-surface-accent'
                          : 'border-border bg-surface-card'
                      }`}
                    >
                      <img
                        src={`/assets/vehicles/${klass.sprite}.svg`}
                        alt=""
                        className="h-14 w-24 shrink-0 object-contain"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block font-display font-semibold ${
                            selected ? 'text-brand-green' : 'text-text-heading'
                          }`}
                        >
                          {klass.label}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-sm text-text-secondary">
                          <Users className="h-3.5 w-3.5" aria-hidden />
                          {klass.seats}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs text-text-secondary">from</span>
                        <span className="block font-semibold text-text-heading">{klass.fare}</span>
                      </span>
                      {selected ? (
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-green" aria-hidden />
                      ) : (
                        <span className="h-6 w-6 shrink-0" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Fares are starting prices. The dispatcher confirms the exact price on the call.
              </p>
              <div ref={continueRef}>
                <NextButton disabled={false} onClick={() => setStep('contact')} />
              </div>
            </StepShell>
          )}

          {step === 'contact' && (
            <StepShell
              title="How do we reach you?"
              onBack={() => setStep(service === 'delivery' ? 'details' : 'vehicle')}
            >
              {/* Deliberately not a signup (ADR-0012 §3): there is no
                  customer-account endpoint, so this step asks for exactly
                  what the dispatcher's phone call needs and nothing that
                  pretends to be a credential. */}
              <div className="kr-rise">
                <div className="space-y-3">
                  <IconField
                    icon={<User className="h-4 w-4 text-text-secondary" />}
                    label="Full name"
                    value={contactName}
                    onChange={setContactName}
                    error={serverErrors.contact_name}
                    placeholder="Full name"
                  />
                  <IconField
                    icon={<Phone className="h-4 w-4 text-text-secondary" />}
                    label="Phone number"
                    value={contactPhone}
                    onChange={setContactPhone}
                    error={serverErrors.contact_phone}
                    placeholder="Phone number"
                    hint="A dispatcher calls this number to confirm your order and the price."
                  />
                  <IconField
                    icon={<Mail className="h-4 w-4 text-text-secondary" />}
                    label="Email address (optional)"
                    value={contactEmail}
                    onChange={setContactEmail}
                    error={serverErrors.contact_email}
                    placeholder="Email address (optional)"
                    type="email"
                  />
                  {/* Honeypot: humans never see it, bots autofill it. */}
                  <div className="absolute left-[-9999px] top-auto" aria-hidden="true">
                    <label>
                      Website
                      <input
                        tabIndex={-1}
                        autoComplete="off"
                        value={honeypot}
                        onChange={(e) => setHoneypot(e.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setStep('review')}
                  disabled={!contactValid}
                  className="mt-6 w-full rounded-lg bg-brand-green px-6 py-3 font-semibold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-50"
                >
                  Continue
                </button>

                <SocialPrefill
                  onIdentity={({ name, email }) => {
                    if (name !== '') setContactName(name)
                    if (email !== '') setContactEmail(email)
                  }}
                />
              </div>
            </StepShell>
          )}

          {step === 'review' && (
            <StepShell title="Confirm your order" onBack={() => setStep('contact')}>
              <dl className="divide-y divide-border rounded-xl border border-border bg-surface-card">
                <ReviewRow label="Service" value={SERVICE_META[service].label} />
                {service !== 'self_drive' && (
                  <>
                    <ReviewRow label="Pickup" value={pickup} />
                    <ReviewRow label="Drop-off" value={dropoff} />
                    <ReviewRow
                      label="When"
                      value={
                        scheduledFor
                          ? new Date(scheduledFor).toLocaleString()
                          : 'As soon as possible'
                      }
                    />
                  </>
                )}
                {service === 'self_drive' && (
                  <>
                    <ReviewRow label="Dates" value={`${startDate} to ${endDate}`} />
                    <ReviewRow
                      label="Vehicle"
                      value={SELF_DRIVE_FLEET.find((m) => m.id === rentalModel)?.name ?? ''}
                    />
                  </>
                )}
                {service === 'ride' && (
                  <ReviewRow
                    label="Vehicle"
                    value={RIDE_CLASSES.find((k) => k.value === vehicleClass)?.label ?? ''}
                  />
                )}
                {service === 'delivery' && (
                  <ReviewRow
                    label="Vehicle"
                    value={
                      DELIVERY_FLEET.find((v) => v.id === effectiveDeliveryVehicle)?.name ?? ''
                    }
                  />
                )}
                {service === 'ride' && rideFor === 'other' && riderName.trim() !== '' && (
                  <ReviewRow label="Rider" value={`${riderName} · ${riderPhone}`} />
                )}
                <ReviewRow label="Name" value={contactName} />
                <ReviewRow label="Phone" value={contactPhone} />
              </dl>
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-text-heading">
                  Anything else? <span className="font-normal text-text-secondary">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-lg border border-border-input bg-surface-page px-4 py-3 text-text-body outline-none transition-[border-color] duration-150 ease-out focus:border-brand-green"
                />
              </div>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className="mt-6 w-full rounded-lg bg-brand-green px-6 py-3 font-semibold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-60"
              >
                {submitting ? 'Sending…' : 'Place order'}
              </button>
            </StepShell>
          )}
        </main>
        <MapPanel
          pickup={service === 'self_drive' ? '' : pickup}
          dropoff={service === 'self_drive' ? '' : dropoff}
        />
      </div>
    </div>
  )
}

/** Kampala city centre; the map opens on the service area, not the world. */
const KAMPALA: [number, number] = [32.5825, 0.3476]

/**
 * The GL surface both engines share. The SDKs are dynamically imported so
 * they stay out of the main bundle and out of jsdom; if GL init fails the
 * panel falls back to OpenStreetMap's keyless embed rather than a blank pane.
 */
type MapEngine = Pick<
  typeof import('maplibre-gl'),
  'Map' | 'Marker' | 'AttributionControl' | 'NavigationControl'
>

/**
 * Mapbox GL with the clean light/dark styles once a token is configured;
 * MapLibre GL over CARTO's keyless Positron styles (the same pale, minimal
 * look) until then. Both expose the same Map/Marker surface, so the single
 * cast below is safe for everything this panel touches.
 */
async function loadMapEngine(token: string | undefined): Promise<{ gl: MapEngine; style: string }> {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (token) {
    const [mod] = await Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')])
    mod.default.accessToken = token
    return {
      gl: mod.default as unknown as MapEngine,
      style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
    }
  }
  const [mod] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
  return {
    gl: mod,
    style: dark
      ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
      : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  }
}

/**
 * The decorative fleet around the city centre, as in the app mockup. Static
 * on purpose: these are ambience, not live positions (the public API exposes
 * no vehicle locations), and idle motion on every visit would be noise.
 */
type VehicleKind = 'sedan' | 'suv' | 'pickup' | 'boda'

const NEARBY_VEHICLES: { at: [number, number]; heading: number; kind: VehicleKind }[] = [
  { at: [32.5856, 0.3496], heading: 40, kind: 'sedan' },
  { at: [32.5795, 0.3506], heading: 205, kind: 'suv' },
  { at: [32.5851, 0.3446], heading: 120, kind: 'sedan' },
  { at: [32.579, 0.345], heading: 320, kind: 'boda' },
  { at: [32.5857, 0.347], heading: 85, kind: 'pickup' },
  { at: [32.5809, 0.3518], heading: 10, kind: 'boda' },
]

/** The fleet sprite set (see public/assets/vehicles/): one unified top-down
 * family, all on the same 512 canvas scale so relative sizes stay honest. */
const VEHICLE_SPRITES: Record<VehicleKind, string> = {
  sedan: '/assets/vehicles/sedan-top.svg',
  suv: '/assets/vehicles/suv-top.svg',
  pickup: '/assets/vehicles/pickup-top.svg',
  boda: '/assets/vehicles/boda-rider-top.svg',
}

/**
 * Style layers that fight the mockup's calm: neighbourhood names, POIs,
 * water names, house numbers, and the dense residential/building texture
 * that greys out the ground. Road names and parks stay. Covers both
 * engines' id conventions (Positron's place_* / poi_*, Mapbox's *-label).
 */
const NOISY_LAYERS =
  /^(place_|poi_|watername_|housenumber|landuse_residential|building)|settlement-|poi-label|airport-label|natural-.*label|water-.*label/

/** The blue "you are here" dot inside its soft accuracy halo (styled in landing.css). */
function userLocationElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'kr-loc'
  el.setAttribute('aria-hidden', 'true')
  return el
}

function vehicleElement(kind: VehicleKind): HTMLImageElement {
  const img = document.createElement('img')
  img.src = VEHICLE_SPRITES[kind]
  // One shared canvas size: the sprites carry honest relative scale, so a
  // boda naturally renders smaller than a pickup.
  img.width = 58
  img.height = 58
  img.className = 'kr-vehicle'
  img.alt = ''
  return img
}

function MapPanel({ pickup, dropoff }: { pickup: string; dropoff: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  const useGl = import.meta.env.MODE !== 'test' && !failed

  useEffect(() => {
    if (!useGl || containerRef.current === null) return

    let map: import('maplibre-gl').Map | undefined
    let cancelled = false

    void (async () => {
      try {
        const { gl, style } = await loadMapEngine(import.meta.env.VITE_MAPBOX_TOKEN)
        if (cancelled || containerRef.current === null) return

        const desktop = window.matchMedia('(min-width: 1024px)').matches
        const m = new gl.Map({
          container: containerRef.current,
          style,
          center: KAMPALA,
          zoom: 14.1,
          attributionControl: false,
          // Zoom without hijacking the page: Ctrl + wheel on desktop,
          // two-finger pinch on touch.
          cooperativeGestures: true,
        })
        map = m
        m.on('load', () => {
          for (const layer of m.getStyle().layers ?? []) {
            if (NOISY_LAYERS.test(layer.id)) m.removeLayer(layer.id)
          }
        })
        m.addControl(new gl.AttributionControl({ compact: true }))
        m.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right')
        if (!desktop) {
          // The sheet covers the lower half on mobile; bias the centre up
          // into the visible window.
          m.jumpTo({
            center: KAMPALA,
            padding: { top: 0, bottom: Math.round(window.innerHeight * 0.45), left: 0, right: 0 },
          })
        }

        new gl.Marker({ element: userLocationElement() }).setLngLat(KAMPALA).addTo(m)
        for (const vehicle of NEARBY_VEHICLES) {
          new gl.Marker({
            element: vehicleElement(vehicle.kind),
            rotation: vehicle.heading,
            rotationAlignment: 'map',
          })
            .setLngLat(vehicle.at)
            .addTo(m)
        }
      } catch {
        // No WebGL or blocked tile hosts — show the flat embed, never a blank pane.
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      map?.remove()
    }
  }, [useGl])

  return (
    <aside className="fixed inset-0 lg:relative lg:inset-auto" aria-label="Map of the service area">
      <div className="h-full lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)]">
        {useGl ? (
          <div ref={containerRef} className="h-full w-full" />
        ) : (
          <iframe
            title="Map of the Kampala service area"
            src="https://www.openstreetmap.org/export/embed.html?bbox=32.44%2C0.18%2C32.78%2C0.47&layer=mapnik&marker=0.3476%2C32.5825"
            className="h-full w-full border-0 dark:brightness-90 dark:contrast-[0.9] dark:hue-rotate-180 dark:invert"
            loading="lazy"
          />
        )}
        {(pickup.trim() !== '' || dropoff.trim() !== '') && (
          <div className="pointer-events-none absolute left-4 top-20 max-w-xs rounded-xl border border-border bg-surface-card/95 px-4 py-3 shadow-md backdrop-blur lg:left-6 lg:top-6">
            {pickup.trim() !== '' && (
              <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
                <CircleDot className="h-4 w-4 shrink-0 text-brand-green" aria-hidden />
                From {pickup.trim()}
              </p>
            )}
            {dropoff.trim() !== '' && (
              <p className="mt-1 flex items-center gap-2 text-sm font-medium text-text-heading">
                <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                To {dropoff.trim()}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * Mobile: the mockup's floating rounded header card over the map.
 * Desktop: the ordinary full-width sticky bar.
 */
function OrderNav() {
  return (
    <header className="fixed inset-x-4 top-4 z-40 rounded-2xl border border-border bg-surface-card shadow-md lg:sticky lg:inset-x-0 lg:top-0 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:border-b lg:bg-surface-page/90 lg:shadow-none lg:backdrop-blur">
      <div className="flex h-14 items-center justify-between px-4 lg:h-16 lg:px-10">
        <Link to="/" className="flex items-center gap-2">
          <img src="/assets/logo-mark.png" alt="" className="h-7 w-7" />
          <span className="font-display font-bold text-text-heading">
            Kangaru<span className="text-brand-green">Ride</span>
          </span>
        </Link>
        <Link
          to="/"
          className="text-sm text-text-secondary transition-colors hover:text-text-heading"
        >
          Cancel
        </Link>
      </div>
    </header>
  )
}

function StepShell({
  title,
  children,
  onBack,
  centerTitle = false,
}: {
  title: string
  children: React.ReactNode
  onBack?: () => void
  centerTitle?: boolean
}) {
  return (
    <div className="kr-rise mt-5 lg:mt-8">
      {onBack !== undefined && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-heading"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </button>
      )}
      <h1
        className={`font-display text-2xl font-bold tracking-tight text-text-heading ${
          centerTitle ? 'text-center lg:text-left' : ''
        }`}
      >
        {title}
      </h1>
      <div className="relative mt-6">{children}</div>
    </div>
  )
}

/** The slice of Google Identity Services this page touches. */
interface GsiNamespace {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string
        callback: (response: { credential: string }) => void
      }) => void
      /** Opens the One Tap / account-chooser prompt. */
      prompt: () => void
    }
  }
}

/** The ID-token claims we read. The token is Google-signed; good enough to prefill a form. */
function decodeJwtPayload(jwt: string): { name?: string; email?: string } | null {
  try {
    const base64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as { name?: string; email?: string }
  } catch {
    return null
  }
}

function GoogleLogo() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

function FacebookLogo() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#FFFFFF"
        d="M16.7 15.5l.53-3.47h-3.33V9.78c0-.95.46-1.87 1.95-1.87h1.51V4.96s-1.37-.23-2.68-.23c-2.73 0-4.52 1.66-4.52 4.66v2.64H7.11v3.47h3.05V24a12.1 12.1 0 0 0 3.74 0v-8.5h2.8Z"
      />
    </svg>
  )
}

/**
 * "Or fill in with" Google / Facebook — a prefill, deliberately not a
 * sign-in (ADR-0012 §3: no customer accounts exist yet). Google runs
 * Google Identity Services when VITE_GOOGLE_CLIENT_ID is configured and
 * prefills the visitor's name and email; either button explains itself
 * when its provider isn't configured yet. The ID token is decoded
 * client-side without signature verification, which is fine for
 * prefilling a form the visitor can edit anyway and would NOT be fine
 * for authentication — a real customer sign-in must verify the token
 * server-side against Google's keys. The order itself still travels the
 * unauthenticated walk-in endpoint.
 */
function SocialPrefill({
  onIdentity,
}: {
  onIdentity: (id: { name: string; email: string }) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  const onIdentityRef = useRef(onIdentity)
  useEffect(() => {
    onIdentityRef.current = onIdentity
  })

  useEffect(() => {
    if (!clientId || import.meta.env.MODE === 'test') return
    let cancelled = false

    const init = () => {
      if (cancelled) return
      try {
        const google = (window as { google?: GsiNamespace }).google
        google?.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const claims = decodeJwtPayload(response.credential)
            if (claims !== null) {
              onIdentityRef.current({ name: claims.name ?? '', email: claims.email ?? '' })
            }
          },
        })
      } catch {
        // Handled at click time: the button falls back to the note below.
      }
    }

    const src = 'https://accounts.google.com/gsi/client'
    if (document.querySelector(`script[src="${src}"]`) !== null) {
      init()
    } else {
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onload = init
      document.head.appendChild(script)
    }
    return () => {
      cancelled = true
    }
  }, [clientId])

  const clickGoogle = () => {
    const google = (window as { google?: GsiNamespace }).google
    if (!clientId || google === undefined) {
      setNote("Google prefill isn't set up yet - the form above works without it.")
      return
    }
    google.accounts.id.prompt()
  }

  const clickFacebook = () => {
    setNote("Facebook prefill isn't set up yet - the form above works without it.")
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-secondary">or fill in with</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={clickGoogle}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-heading transition-colors duration-150 hover:bg-surface-sunken active:scale-[0.98]"
        >
          <GoogleLogo />
          Google
        </button>
        <button
          type="button"
          onClick={clickFacebook}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-heading transition-colors duration-150 hover:bg-surface-sunken active:scale-[0.98]"
        >
          <FacebookLogo />
          Facebook
        </button>
      </div>
      {note !== null && <p className="mt-2 text-center text-xs text-text-secondary">{note}</p>}
    </div>
  )
}

/**
 * The ride pickup card (mockup: "Pickup · Current location · <address>" with
 * a pencil). Collapsed it summarises; expanded it asks who the ride is for -
 * "Myself" offers device location, "Someone else" collects the rider's
 * name and phone so the dispatcher can reach them.
 */
function RidePickupCard({
  pickup,
  onPickupChange,
  rideFor,
  onRideForChange,
  riderName,
  onRiderNameChange,
  riderPhone,
  onRiderPhoneChange,
  error,
}: {
  pickup: string
  onPickupChange: (value: string) => void
  rideFor: 'myself' | 'other'
  onRideForChange: (value: 'myself' | 'other') => void
  riderName: string
  onRiderNameChange: (value: string) => void
  riderPhone: string
  onRiderPhoneChange: (value: string) => void
  error?: string
}) {
  const [expanded, setExpanded] = useState(pickup.trim() === '')
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocateError("This browser can't share your location - please type the pickup instead.")
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        void reverseGeocode(latitude, longitude).then((address) => {
          onPickupChange(address ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
          setLocating(false)
        })
      },
      () => {
        setLocating(false)
        setLocateError("We couldn't read your location - please type the pickup instead.")
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-card">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span
          className="mt-1 h-3 w-3 shrink-0 self-start rounded-full bg-brand-green"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-heading">Pickup</span>
          <span className="mt-0.5 block truncate font-medium text-text-heading">
            {rideFor === 'myself' ? 'Myself' : riderName.trim() || 'Someone else'}
          </span>
          <span className="block truncate text-sm text-text-secondary">
            {pickup.trim() !== '' ? pickup : 'Tap to set the pickup point'}
          </span>
        </span>
        <Pencil className="h-4 w-4 shrink-0 text-brand-green" aria-hidden />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border p-4">
          <div role="radiogroup" aria-label="Who is the ride for?" className="flex gap-2">
            {(
              [
                ['myself', 'Myself'],
                ['other', 'Someone else'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rideFor === value}
                onClick={() => onRideForChange(value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out ${
                  rideFor === value
                    ? 'bg-brand-green text-text-on-brand'
                    : 'bg-surface-sunken text-text-secondary hover:text-text-heading'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {rideFor === 'other' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <IconField
                icon={<User className="h-4 w-4 text-text-secondary" />}
                label="Rider's name"
                value={riderName}
                onChange={onRiderNameChange}
                placeholder="Rider's name"
              />
              <IconField
                icon={<Phone className="h-4 w-4 text-text-secondary" />}
                label="Rider's phone"
                value={riderPhone}
                onChange={onRiderPhoneChange}
                placeholder="Rider's phone"
              />
            </div>
          )}

          <IconField
            icon={<CircleDot className="h-4 w-4 text-brand-green" />}
            label="Pickup location"
            value={pickup}
            onChange={onPickupChange}
            error={error}
            placeholder="Pickup location"
          />

          {rideFor === 'myself' && (
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-green transition-colors hover:text-brand-green-hover disabled:opacity-60"
            >
              <LocateFixed className="h-4 w-4" aria-hidden />
              {locating ? 'Finding you…' : 'Use my current location'}
            </button>
          )}
          {locateError !== null && <p className="text-sm text-text-secondary">{locateError}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * The destination box (mockup: "Where are you going?"). Live suggestions
 * from the geocoder while typing; the visitor's recent destinations when
 * empty. Free text always works - suggestions are an accelerator, not a
 * requirement, so a geocoder outage costs nothing.
 */
function DestinationSearch({
  value,
  onChange,
  error,
  onHistoryPick,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
  /** Fired when the visitor picks a saved destination rather than a search hit. */
  onHistoryPick?: () => void
}) {
  const id = useId()
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [recent, setRecent] = useState<PlaceHit[]>(() => recentDestinations())

  useEffect(() => {
    const query = value.trim()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (query.length < 3) {
        setHits([])
        return
      }
      void searchPlaces(query, controller.signal).then(setHits)
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  const choose = (hit: PlaceHit, fromHistory: boolean) => {
    onChange(placeLabel(hit))
    rememberDestination(hit)
    setRecent(recentDestinations())
    if (fromHistory) onHistoryPick?.()
  }

  const showRecent = value.trim() === '' && recent.length > 0
  const showHits = value.trim().length >= 3 && hits.length > 0

  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-3 rounded-lg border bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-out focus-within:border-brand-green ${
          error !== undefined ? 'border-red-400' : 'border-border-input'
        }`}
      >
        <Search className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
        <span className="sr-only">Destination</span>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Where are you going?"
          autoComplete="off"
          aria-invalid={error !== undefined || undefined}
          className="w-full min-w-0 bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
        />
      </label>
      {error !== undefined && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {(showHits || showRecent) && (
        <ul className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-card">
          {showRecent && (
            <li className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Recent
            </li>
          )}
          {(showHits ? hits : recent).map((hit) => (
            <li key={`${hit.name}|${hit.detail}`}>
              <button
                type="button"
                onClick={() => choose(hit, !showHits)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken"
              >
                {showHits ? (
                  <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                ) : (
                  <History className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text-heading">{hit.name}</span>
                  {hit.detail !== '' && (
                    <span className="block truncate text-sm text-text-secondary">{hit.detail}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * An Uber-style form row: icon, sr-only (or inline) label, borderless input
 * inside one bordered pill. Same idiom as the landing hero form, so a
 * visitor arriving from there reads this as the same product.
 */
function IconField({
  icon,
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
  type = 'text',
  inlineLabel = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
  hint?: string
  type?: string
  inlineLabel?: boolean
}) {
  const id = useId()

  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-3 rounded-lg border bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-out focus-within:border-brand-green ${
          error !== undefined ? 'border-red-400' : 'border-border-input'
        }`}
      >
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        <span className={inlineLabel ? 'shrink-0 text-sm text-text-secondary' : 'sr-only'}>
          {label}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={error !== undefined || undefined}
          className="w-full min-w-0 bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
        />
      </label>
      {hint !== undefined && error === undefined && (
        <p className="mt-1.5 text-xs text-text-secondary">{hint}</p>
      )}
      {error !== undefined && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

function IconSelect({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  const id = useId()

  return (
    <label
      htmlFor={id}
      className="flex items-center gap-3 rounded-lg border border-border-input bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-out focus-within:border-brand-green"
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 cursor-pointer appearance-none bg-transparent text-text-body outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
    </label>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-right text-sm font-medium text-text-heading">{value}</dd>
    </div>
  )
}

function NextButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-navy px-6 py-3 font-semibold text-text-on-chrome transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-brand-navy-soft active:scale-[0.98] disabled:opacity-50 dark:bg-brand-green dark:hover:bg-brand-green-hover"
    >
      Continue
      <ArrowRight className="h-4 w-4" aria-hidden />
    </button>
  )
}

function SuccessScreen({ reference }: { reference: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface-page px-4 text-center">
      <CheckCircle2 className="h-14 w-14 text-brand-green" aria-hidden />
      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-text-heading">
        Order received
      </h1>
      <p className="mt-3 max-w-[40ch] text-text-secondary">
        A dispatcher will call you shortly to confirm the vehicle and the price. Your reference:
      </p>
      <p className="mt-4 rounded-xl border border-border bg-surface-card px-8 py-4 font-mono text-2xl font-bold tracking-widest text-text-heading">
        {reference}
      </p>
      <Link
        to="/"
        className="mt-8 text-sm font-medium text-brand-green transition-colors hover:text-brand-green-hover"
      >
        Back to the start
      </Link>
    </div>
  )
}
