/**
 * Calendar periods as the `from` / `to` strings the report endpoints take
 * (`YYYY-MM-DD`, inclusive; the server widens `to` to the end of that day).
 *
 * In the browser's local calendar, deliberately: a transport officer asking
 * for "this month" means the month on their wall, and the server treats
 * the dates it is given as the caller's. Nothing here assumes Uganda.
 */

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface Period {
  from: string
  to: string
}

/** The first and last day of the month `now` falls in. */
export function currentMonth(now: Date = new Date()): Period {
  return {
    from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  }
}

/**
 * The last `count` whole calendar months up to and including the current
 * one — `count: 3` in August is 1 June to 31 August.
 */
export function recentMonths(count: number, now: Date = new Date()): Period {
  return {
    from: ymd(new Date(now.getFullYear(), now.getMonth() - (count - 1), 1)),
    to: currentMonth(now).to,
  }
}
