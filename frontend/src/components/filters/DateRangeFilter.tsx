import { Input } from '../forms/Input'

/**
 * A date range sent to the server as `from`/`to` (YYYY-MM-DD — a native
 * date input's value is already exactly that). Narrows the query itself,
 * not the page in hand, for the same reason the search box and the client
 * picker moved server-side: filtering the 25 rows already fetched answers
 * the wrong question.
 *
 * Shared by the bookings and trips listings — extracted on its second use
 * (AGENTS.md) rather than copied. What the range *means* differs per list
 * (pickups for bookings, creation for trips) and is the server's business;
 * this component only collects it.
 *
 * `min`/`max` cross-limit the two fields so a browser picker cannot build
 * an inverted range; the server still refuses one with a 422, because a
 * client-side limit is a courtesy and not a rule.
 */
export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  /** `''` is "no bound". */
  from: string
  to: string
  onFromChange: (next: string) => void
  onToChange: (next: string) => void
}) {
  return (
    <>
      <Input
        type="date"
        aria-label="From date"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        max={to || undefined}
        style={{ width: 150 }}
      />
      <Input
        type="date"
        aria-label="To date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        min={from || undefined}
        style={{ width: 150 }}
      />
    </>
  )
}
