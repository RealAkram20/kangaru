import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Local-date ISO (YYYY-MM-DD) without UTC conversion surprises. */
function iso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fromIso(value: string): Date | null {
  if (value === '') return null
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const DAY_MS = 86_400_000

/**
 * The rental range calendar: quick presets up top, then tap a start day and
 * the return day (the same day twice is a one-day rental). Tapping before
 * the start restarts the range, and the band between the endpoints reads as
 * one continuous stay. Hand-rolled on the brand tokens - a date picker
 * dependency for one screen is not this project's style.
 */
export function DateRangePicker({
  start,
  end,
  onChange,
}: {
  start: string
  end: string
  onChange: (start: string, end: string) => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [viewMonth, setViewMonth] = useState(() => {
    const anchor = fromIso(start) ?? today
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  })

  const startDate = fromIso(start)
  const endDate = fromIso(end)

  const pick = (day: Date) => {
    if (startDate === null || endDate !== null) {
      onChange(iso(day), '')
      return
    }
    if (day.getTime() < startDate.getTime()) {
      onChange(iso(day), '')
      return
    }
    onChange(start, iso(day))
  }

  const applyRange = (from: Date, to: Date) => {
    onChange(iso(from), iso(to))
    setViewMonth(new Date(from.getFullYear(), from.getMonth(), 1))
  }

  const presets: { label: string; range: () => [Date, Date] }[] = [
    {
      label: 'This weekend',
      range: () => {
        const sat = new Date(today)
        sat.setDate(sat.getDate() + ((5 - ((sat.getDay() + 6) % 7) + 7) % 7))
        const sun = new Date(sat)
        sun.setDate(sun.getDate() + 1)
        return [sat, sun]
      },
    },
    {
      label: '3 days',
      range: () => {
        const to = new Date(today)
        to.setDate(to.getDate() + 2)
        return [new Date(today), to]
      },
    },
    {
      label: '1 week',
      range: () => {
        const to = new Date(today)
        to.setDate(to.getDate() + 6)
        return [new Date(today), to]
      },
    },
  ]

  const presetActive = (range: [Date, Date]) => start === iso(range[0]) && end === iso(range[1])

  const firstWeekday = (viewMonth.getDay() + 6) % 7 // Monday-first grid
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1),
    ),
  ]

  const canGoBack = viewMonth > new Date(today.getFullYear(), today.getMonth(), 1)
  const monthLabel = viewMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const rentalDays =
    startDate !== null && endDate !== null
      ? Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1
      : null

  return (
    <div className="rounded-2xl border border-border bg-surface-card p-4">
      {/* Quick picks: most rentals are one of these three. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {presets.map((preset) => {
          const range = preset.range()
          const active = presetActive(range)
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={active}
              onClick={() => applyRange(range[0], range[1])}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.97] ${
                active
                  ? 'bg-brand-green text-text-on-brand'
                  : 'bg-surface-sunken text-text-secondary hover:text-text-heading'
              }`}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
          }
          disabled={!canGoBack}
          aria-label="Previous month"
          className="grid h-9 w-9 place-items-center rounded-full text-text-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-text-heading disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="font-display font-semibold text-text-heading">{monthLabel}</p>
        <button
          type="button"
          onClick={() =>
            setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
          }
          aria-label="Next month"
          className="grid h-9 w-9 place-items-center rounded-full text-text-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-text-heading"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 text-center text-xs font-medium text-text-secondary">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => (
          <span key={day} className="py-1">
            {day}
          </span>
        ))}
      </div>

      {/* Keyed so month changes glide in rather than snapping. */}
      <div key={monthLabel} className="kr-month grid grid-cols-7 gap-y-1">
        {cells.map((day, index) => {
          if (day === null) return <span key={`pad-${index}`} />
          const t = day.getTime()
          const disabled = t < today.getTime()
          const isStart = startDate !== null && t === startDate.getTime()
          const isEnd = endDate !== null && t === endDate.getTime()
          const inRange =
            startDate !== null &&
            endDate !== null &&
            t > startDate.getTime() &&
            t < endDate.getTime()
          const rangeExists =
            startDate !== null && endDate !== null && startDate.getTime() !== endDate.getTime()
          const isToday = t === today.getTime()
          return (
            <div key={iso(day)} className="relative h-10">
              {/* The continuous stay band under the endpoints and between them. */}
              {inRange && <span className="absolute inset-y-1 inset-x-0 bg-brand-green-tint" />}
              {isStart && rangeExists && (
                <span className="absolute inset-y-1 left-1/2 right-0 bg-brand-green-tint" />
              )}
              {isEnd && rangeExists && (
                <span className="absolute inset-y-1 left-0 right-1/2 bg-brand-green-tint" />
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => pick(day)}
                aria-label={iso(day)}
                aria-pressed={isStart || isEnd}
                className={`relative z-10 mx-auto grid h-10 w-10 place-items-center rounded-full text-sm transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-95 ${
                  isStart || isEnd
                    ? 'bg-brand-green font-semibold text-text-on-brand shadow-sm'
                    : inRange
                      ? 'text-text-heading'
                      : disabled
                        ? 'text-text-disabled'
                        : 'text-text-body hover:bg-surface-sunken'
                } ${isToday && !isStart && !isEnd ? 'ring-1 ring-inset ring-border-strong' : ''}`}
              >
                {day.getDate()}
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-sm text-text-secondary">
          {startDate === null ? (
            'Pick the day your rental starts.'
          ) : endDate === null ? (
            <>
              <span className="font-medium text-text-heading">{fmt(startDate)}</span> - now pick the
              return day.
            </>
          ) : (
            <>
              <span className="font-medium text-text-heading">{fmt(startDate)}</span> to{' '}
              <span className="font-medium text-text-heading">{fmt(endDate)}</span>
            </>
          )}
        </p>
        {rentalDays !== null && (
          <span className="shrink-0 rounded-full bg-brand-green-tint px-3 py-1 text-sm font-semibold text-brand-green">
            {rentalDays} {rentalDays === 1 ? 'day' : 'days'}
          </span>
        )}
      </div>
    </div>
  )
}
