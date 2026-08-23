/**
 * UGX is a zero-decimal currency (AGENTS.md Money & Billing Standards) —
 * `credit_limit_minor` and similar fields are already whole shillings,
 * never divide by 100. Format per DESIGN.md: thousands-separated,
 * currency named ("UGX 153,520").
 */
export function formatUgx(amountWholeShillings: number): string {
  return `UGX ${Math.round(amountWholeShillings).toLocaleString('en-US')}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Absolute, mono-styled timestamp per DESIGN.md's convention
 * (`2026-07-21 08:14:22`) — used wherever row-level audit precision
 * matters, as opposed to `formatRelativeTime`'s headline use.
 */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${date} ${time}`
}

/**
 * A **calendar date**, rendered as a date rather than an instant.
 *
 * For columns like `drivers.license_expiry` — a `date` cast that reaches the
 * client as `2028-08-17T00:00:00.000000Z` and was being printed raw, so the
 * drivers table showed a 27-character machine timestamp where a licence
 * expiry belongs. That is not only ugly: it cost about 150px of a table that
 * already scrolls sideways.
 *
 * **The string is sliced, never parsed through `new Date()`.** A licence
 * expires on a day, and `new Date('2028-08-17T00:00:00Z')` read back with
 * local getters lands on the 16th anywhere west of Greenwich. Kampala is
 * UTC+3 so it would have looked correct here and silently wrong in Lagos or
 * London — exactly the Uganda assumption `PRODUCT.md` forbids deepening.
 *
 * Month names rather than a numeric format, because `08/09` is September in
 * one country and August in another and this app is meant to travel.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(value: string | null | undefined): string {
  // An em dash for absent, per docs/screen-rules.md §1: a screen that cannot
  // produce a value says so rather than showing a blank or a zero.
  if (value === null || value === undefined || value === '') return '—'

  const [year, month, day] = value.slice(0, 10).split('-')
  const index = Number(month) - 1

  // Anything not date-shaped is returned untouched rather than mangled into a
  // plausible-looking wrong date.
  if (year === undefined || Number.isNaN(index) || MONTHS[index] === undefined) return value

  return `${Number(day)} ${MONTHS[index]} ${year}`
}

/**
 * "2 minutes ago"-style phrasing for a single headline use (e.g. "Last
 * activity ..."). Hand-rolled rather than a date library — the only need
 * is this one relative phrase, not calendar math.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))

  if (seconds < 60) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  return formatTimestamp(iso)
}
