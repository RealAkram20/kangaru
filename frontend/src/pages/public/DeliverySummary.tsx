import { useState } from 'react'
import { ArrowLeft, Check, Clock, MessageSquarePlus, Route, Truck, Wallet } from 'lucide-react'
import { PaymentMethodField, type PaymentMethod } from './PaymentMethodField'
import type { PlaceHit } from './places'
import { PrivacyLine } from './PrivacyNoticePage'
import { formatKm, formatMinutes, type TripEstimate } from './tripEstimate'

/**
 * Who settles the bill. A delivery is the one service where the person
 * ordering is often not the person paying — somebody in Ntinda sends a
 * parcel and the receiver in Mbarara pays the rider for it — so the
 * question is asked on the summary rather than assumed.
 */
export type Payer = 'sender' | 'receiver'

/** Re-exported for the callers that learnt the type here; it lives with the field now. */
export type { PaymentMethod }

/**
 * The last screen of a delivery: what it costs, who pays it, and the route
 * read back in full before it is committed to.
 *
 * It is a separate screen from the generic review because a parcel is the
 * one order where the money has a question in it. A ride is paid by whoever
 * is in the car and a rental by whoever signs for it; a delivery can be paid
 * at either end, on three different rails, and the rider needs to be told
 * which before they set off.
 */
export function DeliverySummary({
  pickup,
  pickupPlace,
  dropoff,
  dropoffPlace,
  vehicleName,
  fare,
  estimate,
  payer,
  onPayerChange,
  paymentMethod,
  onPaymentMethodChange,
  notes,
  onNotesChange,
  onConfirm,
  onBack,
}: {
  pickup: string
  pickupPlace: PlaceHit | null
  dropoff: string
  dropoffPlace: PlaceHit | null
  vehicleName: string
  /** The vehicle's starting fare, already formatted ("UGX 9,000"). */
  fare: string
  /** Null whenever an end was typed rather than picked: see `tripEstimate`. */
  estimate: TripEstimate | null
  payer: Payer
  onPayerChange: (payer: Payer) => void
  paymentMethod: PaymentMethod
  onPaymentMethodChange: (method: PaymentMethod) => void
  notes: string
  onNotesChange: (notes: string) => void
  onConfirm: () => void
  onBack: () => void
}) {
  return (
    <div className="kr-rise mt-5 lg:mt-8">
      {/* The mockup's header: the title is a small green banner rather than
          a heading shouted at somebody who is one tap from finishing. */}
      <div className="relative flex items-center justify-center">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="absolute left-0 -m-2 rounded-full p-2 text-brand-green transition-[color,transform] duration-150 ease-[var(--kr-ease-out)] hover:text-brand-green-hover active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <h1 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-brand-green">
          Delivery – Package summary
        </h1>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface-card p-5 shadow-[0_1px_2px_rgba(0,16,40,0.04)]">
        <h2 className="font-display text-xl font-bold tracking-tight text-text-heading">Payment</h2>

        <p className="mt-3 text-sm font-semibold text-text-heading" id="who-pays">
          Who pays?
        </p>
        <div role="radiogroup" aria-labelledby="who-pays" className="mt-2.5 grid grid-cols-2 gap-3">
          {(
            [
              ['sender', 'Sender (You)'],
              ['receiver', 'Receiver'],
            ] as const
          ).map(([value, label]) => {
            const selected = payer === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onPayerChange(value)}
                /* The check is positioned, not laid out, so choosing the
                   other side does not shove the label sideways. */
                className={`relative flex items-center justify-center rounded-xl border px-4 py-3.5 text-sm font-bold transition-[border-color,background-color,color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.98] ${
                  selected
                    ? 'border-brand-green bg-surface-accent text-brand-green'
                    : 'border-border bg-surface-card text-text-heading hover:border-border-strong'
                }`}
              >
                <span className={selected ? 'pr-7' : undefined}>{label}</span>
                {selected && (
                  <span
                    className="absolute right-3 grid h-5 w-5 place-items-center rounded-full bg-brand-green text-white"
                    aria-hidden
                  >
                    <Check className="h-3 w-3" strokeWidth={3.5} />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <PaymentMethodField
          className="mt-5"
          value={paymentMethod}
          onChange={onPaymentMethodChange}
        />

        <hr className="my-6 border-border" />

        <h2 className="font-display text-xl font-bold tracking-tight text-text-heading">
          Delivery details
        </h2>

        {/* One journey on one rail: green at the collection end, red at the
            door, and a line between them that carries the eye from the first
            to the second — and stops there. A rail running on past the
            drop-off would be drawing a leg nobody is travelling. */}
        <div className="mt-4 grid grid-cols-[0.75rem_1fr] gap-x-4">
          <div className="relative h-full" aria-hidden>
            <span className="absolute left-0 top-1 h-3 w-3 rounded-full bg-brand-green ring-4 ring-surface-card" />
            {/* From the underside of this dot to the centre of the next,
                which sits 10px into the row below. */}
            <span className="absolute -bottom-2.5 left-[4.5px] top-4 w-[3px] rounded-full bg-gradient-to-b from-brand-green to-red-500" />
          </div>
          <Stop title="Pickup" value={pickup} place={pickupPlace} />
          <div className="relative h-full" aria-hidden>
            <span className="absolute left-0 top-1 h-3 w-3 rounded-full bg-red-500 ring-4 ring-surface-card" />
          </div>
          <Stop title="Drop-off" value={dropoff} place={dropoffPlace} />
        </div>

        <dl className="mt-5 border-t border-border">
          <SummaryRow icon={<Truck className="h-5 w-5" aria-hidden />} label="Vehicle">
            {vehicleName}
          </SummaryRow>
          {estimate !== null && (
            <>
              <SummaryRow icon={<Route className="h-5 w-5" aria-hidden />} label="Distance">
                {formatKm(estimate.km)}
              </SummaryRow>
              <SummaryRow icon={<Clock className="h-5 w-5" aria-hidden />} label="Estimated time">
                {formatMinutes(estimate.minutes)}
              </SummaryRow>
            </>
          )}
          <SummaryRow icon={<Wallet className="h-5 w-5" aria-hidden />} label="Price">
            {fare}
          </SummaryRow>
        </dl>

        <NoteField value={notes} onChange={onNotesChange} />
      </div>

      <button
        type="button"
        onClick={onConfirm}
        className="mt-5 w-full rounded-xl bg-brand-green px-6 py-4 font-display text-base font-bold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover active:scale-[0.98]"
      >
        Confirm Delivery
      </button>
      <p className="mt-3 text-center text-xs text-text-secondary">
        A starting fare. The dispatcher confirms the exact price on the call.
      </p>
      {/*
        W1-e. A delivery is the one order that carries a *third party's* name
        and phone — the sender's and the recipient's — so this is the surface
        where somebody is about to hand over details that are not their own.
      */}
      <PrivacyLine />
    </div>
  )
}

/**
 * A stop as the geocoder returns it: the place on top, the address under
 * it. Falls back to the typed text when nothing was geocoded, because a
 * hand-typed street is still the whole answer to "where is it going?".
 */
function Stop({ title, value, place }: { title: string; value: string; place: PlaceHit | null }) {
  const [heading, detail] = twoLines(value, place)

  return (
    <div className="min-w-0 pb-6 last:pb-0">
      <p className="text-sm font-bold text-text-heading">{title}</p>
      <p className="mt-1 truncate text-sm text-text-secondary">{heading}</p>
      {detail !== '' && <p className="truncate text-sm text-text-secondary">{detail}</p>}
    </div>
  )
}

/**
 * A stop as two lines: the place, then where the place is.
 *
 * The geocoder already answers in that shape, except for a device fix —
 * that comes back labelled "Current location" with the whole address in
 * its detail, and "Current location" is not a thing a rider can drive to.
 * So the address is split at its first comma instead, which is where the
 * geocoder puts the boundary between the place and its area anyway.
 */
function twoLines(value: string, place: PlaceHit | null): [string, string] {
  if (place === null) return [value, '']
  if (place.name !== 'Current location') return [place.name, place.detail]

  const address = place.detail !== '' ? place.detail : value
  const comma = address.indexOf(',')
  return comma === -1 ? [address, ''] : [address.slice(0, comma), address.slice(comma + 1).trim()]
}

function SummaryRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-3.5 last:border-b-0">
      <span className="shrink-0 text-text-heading" aria-hidden>
        {icon}
      </span>
      <dt className="text-sm font-bold text-text-heading">{label}</dt>
      <dd className="ml-auto truncate text-sm text-text-secondary">{children}</dd>
    </div>
  )
}

/**
 * The note for the dispatcher, folded away until it is wanted. Deliveries
 * do collect instructions — a gate code, a floor, "call before you knock" —
 * but a textarea sitting open on a confirm screen reads as one more thing
 * standing between somebody and their parcel.
 */
function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(value !== '')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-green transition-colors duration-150 hover:text-brand-green-hover"
      >
        <MessageSquarePlus className="h-4 w-4" aria-hidden />
        Add a note for the rider
      </button>
    )
  }

  return (
    <div className="kr-rise mt-5">
      <label htmlFor="delivery-note" className="mb-2 block text-sm font-semibold text-text-heading">
        Note for the rider <span className="font-normal text-text-secondary">(optional)</span>
      </label>
      <textarea
        id="delivery-note"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={1000}
        autoFocus
        placeholder="Gate code, floor, who to ask for…"
        className="w-full rounded-xl border border-border-input bg-surface-page px-4 py-3 text-sm text-text-body outline-none transition-[border-color] duration-150 ease-[var(--kr-ease-out)] placeholder:text-text-placeholder focus:border-brand-green"
      />
    </div>
  )
}
