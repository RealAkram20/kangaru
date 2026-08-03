import { useId, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Car, CheckCircle2, KeyRound, Package } from 'lucide-react'
import { isAxiosError } from 'axios'
import {
  SERVICE_META,
  submitPublicOrder,
  type PublicOrderPayload,
  type PublicService,
} from './publicOrder'
import './landing.css'

type Step = 'service' | 'details' | 'contact' | 'review'

const STEPS: Step[] = ['service', 'details', 'contact', 'review']

const VEHICLE_CLASSES = [
  { value: 'economy', label: 'Economy' },
  { value: 'standard', label: 'Standard' },
  { value: 'xl', label: 'XL' },
  { value: 'boda', label: 'Boda Boda' },
  { value: 'electric_boda', label: 'Electric Boda' },
]

const ITEM_TYPES = [
  { value: 'documents', label: 'Documents' },
  { value: 'food', label: 'Food' },
  { value: 'parcel', label: 'Parcel' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'appliances', label: 'Appliances' },
  { value: 'other', label: 'Other' },
]

const PACKAGE_SIZES = [
  { value: 'small', label: 'Small (under 5 kg)' },
  { value: 'medium', label: 'Medium (5 to 20 kg)' },
  { value: 'large', label: 'Large (over 20 kg)' },
  { value: 'heavy', label: 'Heavy cargo' },
]

const VEHICLE_CATEGORIES = [
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'van', label: 'Van' },
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

  const [step, setStep] = useState<Step>(params.get('service') ? 'details' : 'service')
  const [service, setService] = useState<PublicService>(initialService)
  const [pickup, setPickup] = useState(params.get('pickup') ?? '')
  const [dropoff, setDropoff] = useState(params.get('dropoff') ?? '')
  const [scheduledFor, setScheduledFor] = useState('')
  const [passengers, setPassengers] = useState('1')
  const [vehicleClass, setVehicleClass] = useState('')
  const [itemType, setItemType] = useState('parcel')
  const [packageSize, setPackageSize] = useState('medium')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [vehicleCategory, setVehicleCategory] = useState('sedan')
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

  const stepIndex = STEPS.indexOf(step)

  const detailsValid = useMemo(() => {
    if (service === 'self_drive') return startDate !== '' && endDate !== ''
    return pickup.trim() !== '' && dropoff.trim() !== ''
  }, [service, pickup, dropoff, startDate, endDate])

  const contactValid = contactName.trim() !== '' && contactPhone.trim().length >= 9

  const buildPayload = (): PublicOrderPayload => {
    const details: Record<string, string | number> = {}
    if (service === 'ride') {
      details.passengers = Number(passengers) || 1
      if (vehicleClass) details.vehicle_class = vehicleClass
    }
    if (service === 'delivery') {
      details.item_type = itemType
      details.package_size = packageSize
      if (recipientName.trim()) details.recipient_name = recipientName.trim()
      if (recipientPhone.trim()) details.recipient_phone = recipientPhone.trim()
    }
    if (service === 'self_drive') {
      details.vehicle_category = vehicleCategory
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
      <main className="mx-auto max-w-xl px-4 pb-20 pt-8 sm:px-6">
        <ol className="flex items-center gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
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
          <StepShell title="What do you need?">
            <div className="grid gap-3">
              {(Object.keys(SERVICE_META) as PublicService[]).map((key) => {
                const icons: Record<PublicService, React.ReactNode> = {
                  ride: <Car className="h-5 w-5" aria-hidden />,
                  delivery: <Package className="h-5 w-5" aria-hidden />,
                  self_drive: <KeyRound className="h-5 w-5" aria-hidden />,
                }
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setService(key)
                      setStep('details')
                    }}
                    className={`flex items-start gap-4 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                      service === key
                        ? 'border-brand-green bg-surface-accent'
                        : 'border-border bg-surface-card'
                    }`}
                  >
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-green-tint text-brand-green">
                      {icons[key]}
                    </span>
                    <span>
                      <span className="block font-semibold text-text-heading">
                        {SERVICE_META[key].label}
                      </span>
                      <span className="mt-0.5 block text-sm text-text-secondary">
                        {SERVICE_META[key].description}
                      </span>
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
                  ? 'What are we delivering?'
                  : 'Your rental'
            }
            onBack={() => setStep('service')}
          >
            <div className="space-y-4">
              {service !== 'self_drive' && (
                <>
                  <Field
                    label="Pickup location"
                    value={pickup}
                    onChange={setPickup}
                    error={serverErrors.pickup_location}
                    placeholder="e.g. Bukerere Rd, Kampala"
                  />
                  <Field
                    label={service === 'ride' ? 'Destination' : 'Drop-off location'}
                    value={dropoff}
                    onChange={setDropoff}
                    error={serverErrors.dropoff_location}
                    placeholder="e.g. Entebbe International Airport"
                  />
                  <div>
                    <label className="mb-1 block text-sm font-medium text-text-heading">When</label>
                    <input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      className="w-full rounded-lg border border-border-input bg-surface-page px-4 py-3 text-text-body outline-none transition-colors focus:border-brand-green"
                    />
                    <p className="mt-1 text-xs text-text-secondary">
                      Leave empty for as soon as possible.
                    </p>
                    {serverErrors.scheduled_for !== undefined && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {serverErrors.scheduled_for}
                      </p>
                    )}
                  </div>
                </>
              )}

              {service === 'ride' && (
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Passengers"
                    value={passengers}
                    onChange={setPassengers}
                    type="number"
                  />
                  <SelectField
                    label="Vehicle preference"
                    value={vehicleClass}
                    onChange={setVehicleClass}
                    options={[{ value: '', label: 'No preference' }, ...VEHICLE_CLASSES]}
                  />
                </div>
              )}

              {service === 'delivery' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <SelectField
                      label="What is it?"
                      value={itemType}
                      onChange={setItemType}
                      options={ITEM_TYPES}
                    />
                    <SelectField
                      label="Size"
                      value={packageSize}
                      onChange={setPackageSize}
                      options={PACKAGE_SIZES}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label="Receiver's name"
                      value={recipientName}
                      onChange={setRecipientName}
                      optional
                    />
                    <Field
                      label="Receiver's phone"
                      value={recipientPhone}
                      onChange={setRecipientPhone}
                      optional
                    />
                  </div>
                </>
              )}

              {service === 'self_drive' && (
                <>
                  <SelectField
                    label="Vehicle type"
                    value={vehicleCategory}
                    onChange={setVehicleCategory}
                    options={VEHICLE_CATEGORIES}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label="From"
                      value={startDate}
                      onChange={setStartDate}
                      type="date"
                      error={serverErrors['details.start_date']}
                    />
                    <Field
                      label="Until"
                      value={endDate}
                      onChange={setEndDate}
                      type="date"
                      error={serverErrors['details.end_date']}
                    />
                  </div>
                </>
              )}
            </div>
            <NextButton disabled={!detailsValid} onClick={() => setStep('contact')} />
          </StepShell>
        )}

        {step === 'contact' && (
          <StepShell title="How do we reach you?" onBack={() => setStep('details')}>
            <div className="space-y-4">
              <Field
                label="Your name"
                value={contactName}
                onChange={setContactName}
                error={serverErrors.contact_name}
              />
              <Field
                label="Phone number"
                value={contactPhone}
                onChange={setContactPhone}
                error={serverErrors.contact_phone}
                placeholder="e.g. 0700 123 456"
                hint="A dispatcher calls this number to confirm your order and the price."
              />
              <Field
                label="Email"
                value={contactEmail}
                onChange={setContactEmail}
                error={serverErrors.contact_email}
                optional
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-text-heading">
                  Anything else? <span className="font-normal text-text-secondary">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-lg border border-border-input bg-surface-page px-4 py-3 text-text-body outline-none transition-colors focus:border-brand-green"
                />
              </div>
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
            <NextButton disabled={!contactValid} onClick={() => setStep('review')} />
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
                      scheduledFor ? new Date(scheduledFor).toLocaleString() : 'As soon as possible'
                    }
                  />
                </>
              )}
              {service === 'self_drive' && (
                <ReviewRow label="Dates" value={`${startDate} to ${endDate}`} />
              )}
              <ReviewRow label="Name" value={contactName} />
              <ReviewRow label="Phone" value={contactPhone} />
            </dl>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="mt-6 w-full rounded-lg bg-brand-green px-6 py-3 font-semibold text-text-on-brand transition-all hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-60"
            >
              {submitting ? 'Sending…' : 'Place order'}
            </button>
          </StepShell>
        )}
      </main>
    </div>
  )
}

function OrderNav() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-xl items-center justify-between px-4 sm:px-6">
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
}: {
  title: string
  children: React.ReactNode
  onBack?: () => void
}) {
  return (
    <div className="kr-rise mt-8">
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
      <h1 className="font-display text-2xl font-bold tracking-tight text-text-heading">{title}</h1>
      <div className="relative mt-6">{children}</div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
  type = 'text',
  optional = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
  hint?: string
  type?: string
  optional?: boolean
}) {
  const id = useId()

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text-heading">
        {label} {optional && <span className="font-normal text-text-secondary">(optional)</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={error !== undefined || undefined}
        className={`w-full rounded-lg border bg-surface-page px-4 py-3 text-text-body outline-none transition-colors focus:border-brand-green ${
          error !== undefined ? 'border-red-400' : 'border-border-input'
        }`}
      />
      {hint !== undefined && error === undefined && (
        <p className="mt-1 text-xs text-text-secondary">{hint}</p>
      )}
      {error !== undefined && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  const id = useId()

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text-heading">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border-input bg-surface-page px-4 py-3 text-text-body outline-none transition-colors focus:border-brand-green"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-green px-6 py-3 font-semibold text-text-on-brand transition-all hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-50"
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
