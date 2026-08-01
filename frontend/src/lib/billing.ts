import type { User } from '../types/auth'
import type { InvoiceLineType, RateCardVersion, RoundingMode } from '../types/billing'

/**
 * The roles AGENTS.md says "can move money and change rates": issuing an
 * invoice, crediting one, and setting prices are Super Admin and Finance
 * only, matching InvoicePolicy and RateCardPolicy.
 *
 * Used to hide actions the server would refuse anyway. It is not the
 * authorization — AGENTS.md is explicit that frontend permissions are never
 * relied on alone, and every one of these endpoints answers 403 on its own.
 * This only avoids offering a button that cannot work.
 */
export function canManageBilling(user: User | null): boolean {
  return user?.role === 'super_admin' || user?.role === 'finance'
}

/**
 * A fresh idempotency key for one intended mutation.
 *
 * Generated once when a dialog opens and reused for every retry inside it,
 * which is precisely the semantics the backend expects: the same key means
 * "this is the request I already sent, tell me what happened to it", and a
 * new key means "bill this again". Minting a new key per click would turn
 * a retry after a timeout into a second charge attempt.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

/** 12500 bp -> "1.25x". Multipliers are integers; this is display only. */
export function formatMultiplier(basisPoints: number): string {
  return `${(basisPoints / 10_000).toFixed(2)}x`
}

/** "22:00:00" -> "22:00". The seconds are always zero and add nothing. */
export function formatClockTime(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5)
}

export function nightWindowLabel(version: RateCardVersion): string {
  const from = formatClockTime(version.night_starts_at)
  const to = formatClockTime(version.night_ends_at)

  if (from === null || to === null || version.night_multiplier_bp === 10_000) {
    return 'No night rate'
  }

  return `${from}–${to} at ${formatMultiplier(version.night_multiplier_bp)}`
}

export const ROUNDING_OPTIONS: { value: RoundingMode; label: string }[] = [
  { value: 'half_up', label: 'Round half up (default)' },
  { value: 'half_down', label: 'Round half down' },
  { value: 'up', label: 'Always round up' },
  { value: 'down', label: 'Always round down' },
]

/**
 * Vehicle categories, mirroring Vehicle::CATEGORIES. A category priced here
 * but absent there — or the reverse — is a vehicle nobody can invoice, so
 * the two lists exist to be compared.
 */
export const VEHICLE_CATEGORIES = ['sedan', 'suv', 'van', 'minibus', 'bus', 'pickup', 'truck'] as const

/**
 * Adjustment lines are corrections to the running subtotal rather than
 * charges, and a negative one is a cap being applied — neither is an error,
 * so both are tinted neutrally rather than as a warning.
 */
export function lineTypeTone(type: InvoiceLineType): 'neutral' | 'info' {
  return type === 'minimum_charge_adjustment' || type === 'maximum_charge_adjustment' ? 'info' : 'neutral'
}
