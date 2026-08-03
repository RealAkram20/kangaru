import { Select } from '../forms/Select'
import type { FilterOption } from '../../types/api'

/**
 * Narrows a platform reader's view to one client, server-side.
 *
 * Shanitah's own staff belong to no tenant and read across every client
 * (ADR-0006), so anything they open is a merged view until they say
 * otherwise. This is how they say otherwise, on the queue, the trip list
 * and the reports.
 *
 * Extracted because it was about to be written a third time. The bookings
 * and trips queues each had their own copy of this block, identical down to
 * the placeholder — and AGENTS.md is explicit that a component appearing
 * more than once becomes a reusable one. The copies were harmless while
 * they agreed; the version that matters is the reports one, where the
 * selected client decides whose revenue a PDF contains.
 *
 * Renders **nothing** when there is no choice to make: a client's own user
 * has exactly one tenant, and the endpoints serve them an empty option list
 * for that reason. That check lives here rather than at each call site so a
 * future caller cannot forget it and show a corporate admin an empty picker
 * of other people's companies.
 */
export function ClientFilterSelect({
  scope,
  clients,
  value,
  onChange,
  allLabel = 'All clients',
  label = 'Client',
  width = 200,
}: {
  scope: 'platform' | 'tenant'
  clients: FilterOption[]
  /** `''` is "every client". */
  value: string
  onChange: (next: string) => void
  /**
   * What the empty option reads as. The reports override it: on the
   * financial report there is no "all clients" answer to give — ADR-0007
   * refuses to total across them — so the empty choice is a prompt rather
   * than an option.
   */
  allLabel?: string
  label?: string
  /**
   * A fixed pixel width suits the queues, where this sits inline beside a
   * search box; the reports place it in a grid cell and want '100%'.
   */
  width?: number | string
}) {
  if (scope !== 'platform' || clients.length === 0) return null

  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[
        { value: '', label: allLabel },
        ...clients.map((client) => ({ value: String(client.value), label: client.label })),
      ]}
      style={{ width }}
    />
  )
}
