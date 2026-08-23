import { useEffect, useState } from 'react'
import { Badge } from '../../components/core/Badge'
import { apiClient } from '../../lib/apiClient'
import { fieldFirstMessage } from '../../lib/apiError'
import { formatTimestamp } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type { DistanceEvidence } from '../../types/trip'

/**
 * The evidence behind one trip's distance (ADR-0045) — every witness, the
 * quality of the trace, and the sentence the resolver wrote.
 *
 * This is what a reviewer reads before clearing a hold, and it is the whole
 * argument for doing so: a clearance overrules the evidence, so the evidence
 * has to be in front of the person overruling it. Read-only; the act is the
 * button beside it.
 *
 * Every figure is the server's. Where a witness did not testify the row shows
 * an em dash — never a zero, which would read as "the vehicle did not move"
 * (`docs/screen-rules.md` §1).
 */

const GRADE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  A: 'success',
  B: 'info',
  C: 'warning',
  U: 'neutral',
}

function km(value: number | null): string {
  return value === null
    ? '—'
    : `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) 0',
        borderBottom: '1px solid var(--border-default)',
        font: 'var(--type-body-dense)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>
        {label}
        {hint !== undefined && (
          <span
            style={{
              display: 'block',
              font: 'var(--type-caption)',
              color: 'var(--text-placeholder)',
            }}
          >
            {hint}
          </span>
        )}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-body)' }}>{value}</span>
    </div>
  )
}

export function DistanceEvidencePanel({ tripId }: { tripId: number }) {
  const [rows, setRows] = useState<DistanceEvidence[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<DistanceEvidence[]>>(`/trips/${tripId}/distance`)
      .then((response) => {
        if (!cancelled) {
          setRows(response.data.data)
          setError(null)
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled)
          setError(fieldFirstMessage(failure, 'Could not load the distance evidence.'))
      })

    return () => {
      cancelled = true
    }
  }, [tripId])

  if (error !== null) {
    return <p style={{ color: 'var(--kr-error)' }}>{error}</p>
  }

  if (rows === null) {
    return <p style={{ color: 'var(--text-secondary)' }}>Loading the evidence…</p>
  }

  const latest = rows[0]

  if (latest === undefined) {
    return (
      <p style={{ color: 'var(--text-secondary)' }}>
        This trip has no distance resolution yet. If it completed some time ago, check that the
        queue worker is running.
      </p>
    )
  }

  const dropped = Object.entries(latest.dropped).filter(([, count]) => count > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--gap-inline)',
          flexWrap: 'wrap',
        }}
      >
        <Badge tone={GRADE_TONE[latest.grade] ?? 'neutral'} size="sm">
          {latest.grade} · {latest.grade_label}
        </Badge>
        <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          Resolved {formatTimestamp(latest.resolved_at)} · policy {latest.policy} · engine{' '}
          {latest.provider ?? '—'}
        </span>
      </div>

      {/* The resolver's own sentence — which branch decided, and on what. It
          is written to be read by a person and is the most useful line here. */}
      <p style={{ font: 'var(--type-body)', color: 'var(--text-body)', margin: 0 }}>
        {latest.reason}
      </p>

      <div>
        <Row label="Would bill" value={km(latest.billed_km)} />
        <Row label="Odometer" value={km(latest.odometer_km)} hint="What the driver typed" />
        <Row
          label="Measured trace"
          value={km(latest.gps_km)}
          hint={
            latest.gps_km === null
              ? 'No usable pings'
              : `${km(latest.matched_km)} matched to roads, ${km(latest.inferred_km)} inferred across gaps`
          }
        />
        <Row
          label="Reference route"
          value={km(latest.route_km)}
          hint={
            latest.reference_source === null
              ? 'No route available'
              : latest.reference_source === 'pins'
                ? 'The road between the order’s pickup and drop-off pins'
                : 'The road between the trace’s own ends — this trip has no pins'
          }
        />
        <Row
          label="Coverage"
          value={pct(latest.coverage_percent)}
          hint="Share of the trip the handset was reporting"
        />
        <Row label="Inferred across gaps" value={pct(latest.inferred_share_percent)} />
        <Row
          label="Pings kept"
          value={`${latest.pings_kept.toLocaleString('en-US')} of ${latest.pings_total.toLocaleString('en-US')}`}
          hint={
            dropped.length === 0
              ? 'Nothing dropped'
              : `Dropped: ${dropped.map(([r, c]) => `${r} ${c}`).join(', ')}`
          }
        />
      </div>

      {rows.length > 1 && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', margin: 0 }}>
          {/* Late pings and a console re-run each append a row; the trip
              carries the latest, and the earlier ones are the record of what
              the platform believed before it knew more. */}
          Resolved {rows.length} times — the figures above are the latest.
        </p>
      )}
    </div>
  )
}
