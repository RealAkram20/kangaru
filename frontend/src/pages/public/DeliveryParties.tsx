import { useId } from 'react'
import { ArrowLeft, Check, Phone, ShieldCheck, User } from 'lucide-react'
import { partyValid, type Party } from './party'

/**
 * "Who is the sender? Who is the receiver?" — the last thing a parcel is
 * asked, and the last screen before it is placed.
 */
export function DeliveryParties({
  customerName,
  sender,
  onSenderChange,
  receiver,
  onReceiverChange,
  pinRequired,
  onPinRequiredChange,
  submitting,
  onContinue,
  onBack,
}: {
  customerName: string
  sender: Party
  onSenderChange: (party: Party) => void
  receiver: Party
  onReceiverChange: (party: Party) => void
  pinRequired: boolean
  onPinRequiredChange: (required: boolean) => void
  submitting: boolean
  onContinue: () => void
  onBack: () => void
}) {
  const ready = partyValid(sender) && partyValid(receiver)

  return (
    <div className="kr-rise mt-5 lg:mt-8">
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
          Delivery – Sender &amp; recipient
        </h1>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface-card p-5 shadow-[0_1px_2px_rgba(0,16,40,0.04)]">
        <PartyGroup
          question="Who is the sender?"
          role="sender"
          /* The account holder is the sender by default: it is who is
             standing over the parcel nine times out of ten. */
          meLabel={`Me (${customerName})`}
          otherLabel="Someone else"
          party={sender}
          onChange={onSenderChange}
        />

        <div className="mt-8">
          <PartyGroup
            question="Who is the receiver?"
            role="receiver"
            /* Reversed on purpose. Somebody sending a parcel is almost
               never sending it to themselves, so the new-person form is
               the default and "me" is the exception underneath it. */
            meLabel={`Me (${customerName})`}
            otherLabel="Add new receiver"
            otherFirst
            party={receiver}
            onChange={onReceiverChange}
          />
        </div>

        {/* Handover, not just delivery. Without a code the parcel is "left
            with whoever answered the gate", which is the version of this
            service that loses things. */}
        <div className="mt-8 rounded-xl border border-border bg-surface-card p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 shrink-0 text-text-heading" aria-hidden />
            <span id="pin-label" className="flex-1 font-medium text-text-heading">
              Confirm delivery with PIN
            </span>
            <Switch checked={pinRequired} onChange={onPinRequiredChange} labelledBy="pin-label" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">
            {pinRequired
              ? 'The receiver gives the rider a four-digit code at handover. Dispatch sends it to them once a rider is assigned.'
              : 'The rider hands the parcel to whoever meets them at the drop-off.'}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onContinue}
        disabled={!ready || submitting}
        className="mt-6 w-full rounded-xl bg-brand-green px-6 py-4 font-display text-base font-bold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Continue'}
      </button>
    </div>
  )
}

/**
 * One end of the parcel: the question, two stacked choices, and — when the
 * choice is a person we do not already know — their name and number.
 */
function PartyGroup({
  question,
  role,
  meLabel,
  otherLabel,
  otherFirst = false,
  party,
  onChange,
}: {
  question: string
  role: 'sender' | 'receiver'
  meLabel: string
  otherLabel: string
  /** Puts the new-person choice above "me", where it is the likelier answer. */
  otherFirst?: boolean
  party: Party
  onChange: (party: Party) => void
}) {
  const id = useId()
  const options = [
    { isMe: true, label: meLabel },
    { isMe: false, label: otherLabel },
  ]
  if (otherFirst) options.reverse()

  return (
    <div>
      <p id={id} className="font-display text-base font-bold text-text-heading">
        {question}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="mt-3 space-y-3">
        {options.map((option) => {
          const selected = party.isMe === option.isMe
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ ...party, isMe: option.isMe })}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-4 text-left font-semibold transition-[border-color,background-color,color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.99] ${
                selected
                  ? 'border-brand-green bg-surface-accent text-brand-green'
                  : 'border-transparent bg-surface-sunken text-text-heading hover:border-border-strong'
              }`}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {selected ? (
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-green text-white"
                  aria-hidden
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                </span>
              ) : (
                <span
                  className="h-6 w-6 shrink-0 rounded-full border-2 border-border-strong"
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>

      {!party.isMe && (
        <div className="kr-rise mt-3 space-y-3">
          <Field
            icon={<User className="h-4 w-4 text-text-secondary" aria-hidden />}
            label={role === 'sender' ? "Sender's name" : "Receiver's name"}
            value={party.name}
            onChange={(name) => onChange({ ...party, name })}
          />
          <Field
            icon={<Phone className="h-4 w-4 text-text-secondary" aria-hidden />}
            label={role === 'sender' ? "Sender's phone" : "Receiver's phone"}
            value={party.phone}
            onChange={(phone) => onChange({ ...party, phone })}
            type="tel"
          />
        </div>
      )}
    </div>
  )
}

/** The same bordered pill the rest of the order form uses. */
function Field({
  icon,
  label,
  value,
  onChange,
  type = 'text',
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  const id = useId()

  return (
    <label
      htmlFor={id}
      className="flex items-center gap-3 rounded-lg border border-border-input bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-[var(--kr-ease-out)] focus-within:border-brand-green"
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={label}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
      />
    </label>
  )
}

/**
 * The knob moves on `transform` alone — the one property that neither
 * lays out nor paints, so the switch stays smooth on the cheapest phone
 * the app runs on.
 */
function Switch({
  checked,
  onChange,
  labelledBy,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  labelledBy: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-[var(--kr-ease-out)] ${
        checked ? 'bg-brand-green' : 'bg-border-strong'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--kr-ease-out)] ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
        aria-hidden
      />
    </button>
  )
}
