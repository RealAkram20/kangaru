import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { Checkbox } from '../components/forms/Checkbox'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'

/**
 * Platform settings (ADR-0014) — the system's own name, contacts and
 * defaults, editable by whoever holds `settings.manage`.
 *
 * Like RolesPage, deliberately not behind RequireNavAccess: a custom
 * role holding the permission is invisible to a slug list, so the page
 * gates on whether the API answers — a 403 renders as an answer, not an
 * apology.
 *
 * Motion here is deliberately quiet. A settings form is occasional-use
 * chrome, so nothing animates for decoration; the one earned animation
 * is save feedback — the button's label morphs to "Saved" and back,
 * because a write the interface never acknowledges feels lost.
 */

interface Settings {
  branding: {
    app_name: string
    tagline: string | null
    meta_description: string | null
    contact_email: string
    contact_phone: string | null
    logo_path: string | null
    favicon_path: string | null
  }
  regional: {
    currency: string
    timezone: string
    date_format: string
  }
  ordering: {
    walk_in_enabled: boolean
    rate_limit_per_minute: number
  }
  booking: {
    approval_required: boolean
    max_advance_days: number
  }
}

/** The public disk's URL for a stored asset path, cross-origin safe. */
function assetUrl(path: string | null): string | null {
  if (!path) return null
  return `${new URL(import.meta.env.VITE_API_BASE_URL).origin}/storage/${path}`
}

export function SystemSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get('/settings')
      setSettings(response.data.data.settings as Settings)
      setRefused(false)
      setError(null)
    } catch (failure) {
      const problem = apiError(failure, 'Could not load settings.')
      if (problem.code === 'FORBIDDEN') {
        setRefused(true)
        return
      }
      setError(problem.message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (refused) {
    return (
      <Card>
        <EmptyState
          icon="lock"
          title="Platform settings are not available to your role"
          description="Changing the platform's name, contacts and defaults needs the settings permission. Ask a Super Admin if you need access."
        />
      </Card>
    )
  }

  if (error !== null) {
    return (
      <Alert tone="error" title="Settings" onDismiss={() => setError(null)}>
        {error}
      </Alert>
    )
  }

  if (settings === null) {
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <BrandingCard branding={settings.branding} onSaved={setSettings} />
      <OrderingCard ordering={settings.ordering} onSaved={setSettings} />
      <BookingCard booking={settings.booking} onSaved={setSettings} />
      <RegionalCard regional={settings.regional} onSaved={setSettings} />
    </div>
  )
}

/**
 * Save-button state machine shared by both cards: idle → saving →
 * saved (1.6s) → idle. The label morph is the save feedback; anything
 * louder (a toast, a banner) would outweigh the action.
 */
function useSave(group: string, onSaved: (s: Settings) => void) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const save = async (values: Record<string, unknown>) => {
    setState('saving')
    setMessage(null)
    setErrors({})
    try {
      const response = await apiClient.patch(`/settings/${group}`, values)
      onSaved(response.data.data.settings as Settings)
      setState('saved')
      timer.current = setTimeout(() => setState('idle'), 1600)
    } catch (failure) {
      const problem = apiError(failure, 'Could not save settings.')
      setErrors(fieldErrors(problem))
      setMessage(Object.keys(fieldErrors(problem)).length === 0 ? problem.message : null)
      setState('idle')
    }
  }

  return { state, errors, message, setMessage, save }
}

function SaveButton({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  return (
    <div>
      <Button
        type="submit"
        disabled={state === 'saving'}
        iconLeft={state === 'saved' ? 'check' : undefined}
      >
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save changes'}
      </Button>
    </div>
  )
}

function BrandingCard({
  branding,
  onSaved,
}: {
  branding: Settings['branding']
  onSaved: (s: Settings) => void
}) {
  const [appName, setAppName] = useState(branding.app_name)
  const [tagline, setTagline] = useState(branding.tagline ?? '')
  const [metaDescription, setMetaDescription] = useState(branding.meta_description ?? '')
  const [contactEmail, setContactEmail] = useState(branding.contact_email)
  const [contactPhone, setContactPhone] = useState(branding.contact_phone ?? '')
  const { state, errors, message, setMessage, save } = useSave('branding', onSaved)

  return (
    <Card
      title="Branding"
      subtitle="The platform's public identity — shown on the landing page, sign-in screen and browser tab."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save({
            app_name: appName,
            tagline: tagline || null,
            meta_description: metaDescription || null,
            contact_email: contactEmail,
            contact_phone: contactPhone || null,
          })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Branding" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <FormField label="App name" htmlFor="settings-app-name" error={errors.app_name} required>
          <Input
            id="settings-app-name"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Tagline" htmlFor="settings-tagline" error={errors.tagline}>
          <Input id="settings-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </FormField>

        <FormField
          label="Meta description"
          htmlFor="settings-meta"
          hint="What search engines show under the name. One or two sentences."
          error={errors.meta_description}
        >
          <Input
            id="settings-meta"
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
          />
        </FormField>

        <FormField
          label="Contact email"
          htmlFor="settings-contact-email"
          error={errors.contact_email}
          required
        >
          <Input
            id="settings-contact-email"
            type="email"
            iconLeft="mail"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Contact phone" htmlFor="settings-contact-phone" error={errors.contact_phone}>
          <Input
            id="settings-contact-phone"
            iconLeft="phone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </FormField>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-4)',
          }}
        >
          <AssetUploader
            label="Logo"
            hint="PNG, JPG, SVG or WebP, up to 2MB."
            asset="logo"
            currentPath={branding.logo_path}
            onSaved={onSaved}
          />
          <AssetUploader
            label="Favicon"
            hint="PNG, ICO or SVG, up to 512KB."
            asset="favicon"
            currentPath={branding.favicon_path}
            onSaved={onSaved}
          />
        </div>

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

function AssetUploader({
  label,
  hint,
  asset,
  currentPath,
  onSaved,
}: {
  label: string
  hint: string
  asset: 'logo' | 'favicon'
  currentPath: string | null
  onSaved: (s: Settings) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const url = assetUrl(currentPath)

  const upload = async (file: File) => {
    setUploading(true)
    setProblem(null)
    const body = new FormData()
    body.append('file', file)
    try {
      const response = await apiClient.post(`/settings/assets/${asset}`, body)
      onSaved(response.data.data.settings as Settings)
    } catch (failure) {
      setProblem(apiError(failure, `Could not upload the ${label.toLowerCase()}.`).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span style={{ font: 'var(--type-label)', color: 'var(--text-heading)' }}>{label}</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3)',
          border: '1px dashed var(--border-input)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--surface-sunken)',
        }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            style={{ height: 36, maxWidth: 96, objectFit: 'contain', borderRadius: 4 }}
          />
        ) : (
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-placeholder)' }}>
            None yet
          </span>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconLeft="upload"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          aria-label={`Upload ${label.toLowerCase()}`}
          accept={asset === 'logo' ? '.png,.jpg,.jpeg,.svg,.webp' : '.png,.ico,.svg'}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
      </div>
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
        {problem ?? hint}
      </span>
    </div>
  )
}

function OrderingCard({
  ordering,
  onSaved,
}: {
  ordering: Settings['ordering']
  onSaved: (s: Settings) => void
}) {
  const [enabled, setEnabled] = useState(ordering.walk_in_enabled)
  const [rateLimit, setRateLimit] = useState(String(ordering.rate_limit_per_minute))
  const { state, errors, message, setMessage, save } = useSave('ordering', onSaved)

  return (
    <Card
      title="Public ordering"
      subtitle="The walk-in order form on the public site — the intake switch and its abuse limit."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save({ walk_in_enabled: enabled, rate_limit_per_minute: Number(rateLimit) })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Public ordering" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <Checkbox
          label="Accept online orders"
          hint="Off pauses the public order form immediately — visitors are told to call the dispatch desk instead. Nothing already in the queue is affected."
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />

        <FormField
          label="Orders per minute, per visitor"
          htmlFor="settings-rate-limit"
          hint="The public form's abuse limit per IP address. Raise it if a shared office network genuinely hits the ceiling."
          error={errors.rate_limit_per_minute}
          required
        >
          <Input
            id="settings-rate-limit"
            type="number"
            min={1}
            max={60}
            value={rateLimit}
            onChange={(e) => setRateLimit(e.target.value)}
            required
            style={{ maxWidth: 120 }}
          />
        </FormField>

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

function BookingCard({
  booking,
  onSaved,
}: {
  booking: Settings['booking']
  onSaved: (s: Settings) => void
}) {
  const [approvalRequired, setApprovalRequired] = useState(booking.approval_required)
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(String(booking.max_advance_days))
  const { state, errors, message, setMessage, save } = useSave('booking', onSaved)

  return (
    <Card
      title="Booking rules"
      subtitle="How corporate bookings move from request to dispatch."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save({
            approval_required: approvalRequired,
            max_advance_days: Number(maxAdvanceDays),
          })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Booking rules" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <Checkbox
          label="Require approval before dispatch"
          hint="Off means new bookings are approved automatically at creation — the requester's own booking, with no second pair of eyes. Every auto-approval is still audited."
          checked={approvalRequired}
          onChange={(e) => setApprovalRequired(e.target.checked)}
        />

        <FormField
          label="Maximum days in advance"
          htmlFor="settings-max-advance"
          hint="How far ahead a pickup may be scheduled, on bookings and the public order form alike."
          error={errors.max_advance_days}
          required
        >
          <Input
            id="settings-max-advance"
            type="number"
            min={1}
            max={365}
            value={maxAdvanceDays}
            onChange={(e) => setMaxAdvanceDays(e.target.value)}
            required
            style={{ maxWidth: 120 }}
          />
        </FormField>

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

function RegionalCard({
  regional,
  onSaved,
}: {
  regional: Settings['regional']
  onSaved: (s: Settings) => void
}) {
  const [currency, setCurrency] = useState(regional.currency)
  const [timezone, setTimezone] = useState(regional.timezone)
  const [dateFormat, setDateFormat] = useState(regional.date_format)
  const { state, errors, message, setMessage, save } = useSave('regional', onSaved)

  return (
    <Card
      title="Regional defaults"
      subtitle="Currency, timezone and date formatting used across invoices and reports."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save({ currency, timezone, date_format: dateFormat })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Regional defaults" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <FormField
          label="Currency"
          htmlFor="settings-currency"
          hint="Three-letter code (UGX, KES, USD)."
          error={errors.currency}
          required
        >
          <Input
            id="settings-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </FormField>

        <FormField
          label="Timezone"
          htmlFor="settings-timezone"
          hint="An IANA name, like Africa/Kampala."
          error={errors.timezone}
          required
        >
          <Input
            id="settings-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Date format" htmlFor="settings-date-format" error={errors.date_format} required>
          <Input
            id="settings-date-format"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value)}
            required
          />
        </FormField>

        <SaveButton state={state} />
      </form>
    </Card>
  )
}
