import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { formatRelativeTime } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type { ExportFormat, ReportExport, ReportType, TripReportFilters } from '../../types/report'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Icon } from '../../components/core/Icon'
import { Alert } from '../../components/feedback/Alert'
import { EmptyState } from '../../components/feedback/EmptyState'

const FORMATS: { value: ExportFormat; label: string; icon: string; hint: string }[] = [
  { value: 'csv', label: 'CSV', icon: 'file-text', hint: 'For reconciliation in any tool' },
  { value: 'xlsx', label: 'Excel', icon: 'sheet', hint: 'Formatted workbook with totals' },
  { value: 'pdf', label: 'PDF', icon: 'file-type-2', hint: 'For sending or filing' },
]

const STATUS_TONE: Record<ReportExport['status'], 'neutral' | 'info' | 'success' | 'error'> = {
  queued: 'neutral',
  processing: 'info',
  completed: 'success',
  failed: 'error',
}

/** 3 s: fast enough to feel immediate, slow enough not to hammer the API. */
const POLL_MS = 3000

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Requests report files and tracks them to completion.
 *
 * Generation is queued server-side (AGENTS.md: nothing over 3 s blocks a
 * request), so the request returns 202 and the file arrives later. This
 * panel polls while anything is still running and stops as soon as
 * everything is terminal — an idle report page should make no requests.
 */
export function ExportPanel({
  filters,
  report,
}: {
  filters: TripReportFilters
  report: ReportType
}) {
  const [exports, setExports] = useState<ReportExport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState<ExportFormat | null>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<ReportExport[]>>('/reports/exports')
        .then((response) => setExports(response.data.data))
        .catch((failure: unknown) => setError(apiError(failure, 'Could not load your exports.').message)),
    [],
  )

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<ReportExport[]>>('/reports/exports')
      .then((response) => {
        if (!cancelled) setExports(response.data.data)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(apiError(failure, 'Could not load your exports.').message)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Poll only while something is unfinished, and clear the timer the moment
  // it is not — a page left open overnight should be silent.
  useEffect(() => {
    const pending = exports?.some((e) => !e.is_terminal) ?? false

    if (!pending) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
      return
    }

    timer.current = window.setTimeout(() => void load(), POLL_MS)

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [exports, load])

  const request = async (format: ExportFormat) => {
    setRequesting(format)
    setError(null)

    try {
      await apiClient.post('/reports/exports', {
        format,
        report,
        from: filters.from || null,
        to: filters.to || null,
        // The aggregates group by driver or vehicle, so filtering to one of
        // either is meaningless there — and the server rejects the filter
        // rather than ignoring it, so it is not sent.
        ...(report === 'trips'
          ? { vehicle_id: filters.vehicle_id || null, driver_id: filters.driver_id || null }
          : {}),
      })

      await load()
    } catch (failure) {
      // REPORT_TOO_LARGE lands here; the server's message names the trip
      // count and says how to narrow it, so it is shown verbatim.
      setError(apiError(failure, 'Could not start this export.').message)
    } finally {
      setRequesting(null)
    }
  }

  const download = async (item: ReportExport) => {
    setError(null)

    try {
      const response = await apiClient.get(`/reports/exports/${item.id}/download`, {
        responseType: 'blob',
      })

      const disposition = String(response.headers['content-disposition'] ?? '')
      const match = /filename="?([^"]+)"?/.exec(disposition)

      const url = URL.createObjectURL(response.data as Blob)
      const link = document.createElement('a')
      link.href = url
      link.download = match?.[1] ?? `trip-report.${item.format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (failure) {
      setError(await readBlobError('Could not download this export.', failure))
    }
  }

  return (
    <Card
      title="Export"
      subtitle="Generated in the background using the filters above"
      padding="none"
      actions={
        <div style={{ display: 'flex', gap: 'var(--gap-inline)' }}>
          {FORMATS.map((format) => (
            <Button
              key={format.value}
              size="sm"
              variant="secondary"
              iconLeft={format.icon}
              title={format.hint}
              loading={requesting === format.value}
              disabled={requesting !== null}
              onClick={() => void request(format.value)}
            >
              {format.label}
            </Button>
          ))}
        </div>
      }
    >
      {error && (
        <Alert tone="warning" title="Export problem" style={{ margin: 'var(--space-4)' }} onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {exports !== null && exports.length === 0 ? (
        <EmptyState
          compact
          icon="download"
          title="No exports yet"
          description="Pick a format above. Large reports keep generating in the background — you can leave this page."
        />
      ) : (
        <div>
          {(exports ?? []).map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              <Icon
                name={FORMATS.find((f) => f.value === item.format)?.icon ?? 'file'}
                size={16}
                style={{ color: 'var(--text-secondary)' }}
              />

              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: 'var(--type-label)', color: 'var(--text-body)' }}>
                  {item.format_label}
                  {item.row_count !== null && ` · ${item.row_count.toLocaleString('en-US')} trips`}
                  {item.file_size !== null && ` · ${formatBytes(item.file_size)}`}
                </span>
                <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                  {formatRelativeTime(item.created_at)}
                  {item.requested_by && ` · ${item.requested_by}`}
                  {item.error && ` · ${item.error}`}
                </span>
              </span>

              <Badge tone={STATUS_TONE[item.status]} size="sm">
                {item.status}
              </Badge>

              <Button
                size="sm"
                variant="ghost"
                iconLeft="download"
                disabled={!item.is_downloadable}
                onClick={() => void download(item)}
              >
                Download
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * With `responseType: 'blob'`, an error body is a Blob too, so the server's
 * message has to be parsed back out of it.
 */
async function readBlobError(fallback: string, failure: unknown): Promise<string> {
  const body = (failure as { response?: { data?: unknown } })?.response?.data

  if (body instanceof Blob) {
    try {
      const parsed: unknown = JSON.parse(await body.text())
      const message = (parsed as { message?: unknown }).message
      if (typeof message === 'string') return message
    } catch {
      // Not JSON — fall through to the generic message.
    }
  }

  return fallback
}
