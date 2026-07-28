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
