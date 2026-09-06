import { Banknote, ChevronDown, CreditCard, Smartphone } from 'lucide-react'

/** The rails an order can be paid on, matching the backend's enum. */
export type PaymentMethod = 'cash' | 'mobile_money' | 'card'

const METHOD_ICONS: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote className="h-5 w-5" aria-hidden />,
  mobile_money: <Smartphone className="h-5 w-5" aria-hidden />,
  card: <CreditCard className="h-5 w-5" aria-hidden />,
}

/**
 * The payment-method select, shared by every order that has a bill.
 *
 * **Extracted from `DeliverySummary`, because a ride needs it too.** A ride
 * order used to send no `payment_method` at all — the field lived only on the
 * delivery summary — so the driver's Trip in Progress screen showed "Payment"
 * with nothing under it on every ride, and the driver had no idea whether to
 * expect notes or a Mobile Money prompt at the kerb. AGENTS.md: if it appears
 * twice it becomes shared, and a second copy of a three-item enum is exactly
 * how the two would drift.
 *
 * The cash label is the one thing that differs by service — "Cash on
 * delivery" makes no sense for a ride — so it is a prop with the delivery
 * wording as the default, rather than a second component.
 */
export function PaymentMethodField({
  value,
  onChange,
  cashLabel = 'Cash on delivery',
  className = '',
}: {
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
  cashLabel?: string
  className?: string
}) {
  const methods: { value: PaymentMethod; label: string }[] = [
    { value: 'cash', label: cashLabel },
    { value: 'mobile_money', label: 'Mobile Money' },
    { value: 'card', label: 'Card' },
  ]

  return (
    <div className={className}>
      <label htmlFor="payment-method" className="block text-sm font-semibold text-text-heading">
        Payment method
      </label>
      <div className="relative mt-2.5">
        <span
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-green"
          aria-hidden
        >
          {METHOD_ICONS[value]}
        </span>
        <select
          id="payment-method"
          value={value}
          onChange={(e) => onChange(e.target.value as PaymentMethod)}
          className="w-full cursor-pointer appearance-none rounded-xl border border-border bg-surface-card py-3.5 pl-12 pr-11 font-medium text-text-heading outline-none transition-[border-color] duration-150 ease-[var(--kr-ease-out)] focus:border-brand-green"
        >
          {methods.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-green"
          aria-hidden
        />
      </div>
    </div>
  )
}
