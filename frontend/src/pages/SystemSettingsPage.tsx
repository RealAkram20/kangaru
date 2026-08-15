import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { Checkbox } from '../components/forms/Checkbox'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'
import { Textarea } from '../components/forms/Textarea'
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
  legal: {
    terms: string | null
    privacy: string | null
  }
  auth: {
    password_reset_enabled: boolean
    google_enabled: boolean
    facebook_enabled: boolean
    google_client_ids: string | null
    facebook_app_id: string | null
    facebook_app_secret: SecretValue
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
  /** ADR-0029 §3 and ADR-0034. In the catalogue since then, with no UI. */
  billing: {
    driver_commission_percent: number
    bonus_enabled: boolean
    bonus_weekly_trip_target: number
    bonus_weekly_amount_minor: number
  }
  /** ADR-0035: the two numbers that decide whether a reading is believed. */
  tracking: {
    variance_threshold_percent: number
    odometer_max_km_per_trip: number
  }
  mail: {
    enabled: boolean
    host: string | null
    port: number
    username: string | null
    password: SecretValue
    encryption: 'tls' | 'none'
    from_address: string | null
    from_name: string | null
  }
  sms: {
    provider: '' | 'africastalking' | 'twilio' | null
    sender_id: string | null
    api_key: SecretValue
    api_secret: SecretValue
  }
  maps: {
    routing_enabled: boolean
    routing_provider: 'google' | 'osrm'
    osrm_base_url: string
    /** Write-only: the API answers whether a key exists, never what it is. */
    api_key: SecretValue
  }
  payments: {
    mtn_momo_api_user: string | null
    mtn_momo_api_key: SecretValue
    airtel_money_client_id: string | null
    airtel_money_client_secret: SecretValue
  }
}

/** ADR-0014 §3: a credential's value never crosses the API — only this. */
interface SecretValue {
  configured: boolean
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

  // Deliberately `.then()` rather than `await` inside an async helper, the
  // same shape DriversPage documents: `react-hooks/set-state-in-effect`
  // reads a synchronous call to a state-setting helper as a set during
  // render, and it is right to — the promise chain defers the write to a
  // microtask, which is what we mean. This page was the one that did not
  // follow the pattern, and it was the one failing lint.
  const load = useCallback(
    () =>
      apiClient
        .get('/settings')
        .then((response) => {
          setSettings(response.data.data.settings as Settings)
          setRefused(false)
          setError(null)
        })
        .catch((failure: unknown) => {
          const problem = apiError(failure, 'Could not load settings.')
          if (problem.code === 'FORBIDDEN') {
            setRefused(true)
            return
          }
          setError(problem.message)
        }),
    [],
  )

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
      {/* Money and measurement sit together, above the credential slots:
          these are the numbers an operator actually revisits. */}
      <BillingCard billing={settings.billing} onSaved={setSettings} />
      <TrackingCard tracking={settings.tracking} onSaved={setSettings} />
      <MapsCard maps={settings.maps} onSaved={setSettings} />
      <RegionalCard regional={settings.regional} onSaved={setSettings} />
      <LegalCard legal={settings.legal} onSaved={setSettings} />
      <AuthMethodsCard auth={settings.auth} mailEnabled={settings.mail.enabled} onSaved={setSettings} />
      <MailCard mail={settings.mail} onSaved={setSettings} />
      <SmsCard sms={settings.sms} onSaved={setSettings} />
      <PaymentsCard payments={settings.payments} onSaved={setSettings} />
    </div>
  )
}

/**
 * A write-only credential (ADR-0014 §3). Shows whether one is stored;
 * typing here stages a replacement. An empty box means "leave it" — it
 * is omitted from the save entirely, never sent as an empty value.
 */
function SecretField({
  label,
  htmlFor,
  secret,
  value,
  onChange,
  error,
}: {
  label: string
  htmlFor: string
  secret: SecretValue
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <FormField
      label={label}
      htmlFor={htmlFor}
      hint={
        secret.configured
          ? 'Configured. Stored values are never shown — type here only to replace it.'
          : 'Not configured yet.'
      }
      error={error}
    >
      <Input
        id={htmlFor}
        type="password"
        iconLeft="key-round"
        autoComplete="new-password"
        placeholder={secret.configured ? '••••••••' : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  )
}

/** Drops empty-string secret values so "leave it" never overwrites. */
function withSecrets(
  values: Record<string, unknown>,
  secrets: Record<string, string>,
): Record<string, unknown> {
  const out = { ...values }
  for (const [key, value] of Object.entries(secrets)) {
    if (value !== '') out[key] = value
  }
  return out
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

/**
 * Road routing for the Driver App's maps (`maps` group).
 *
 * **The maps themselves need no key.** They are MapLibre against CARTO's free
 * tiles, and they draw Kampala with or without anything on this card. What is
 * configured here is *routing*: the line that follows real roads, the road
 * distance, and the arrival estimate that comes with it. Saying so on the card
 * matters — an operator who thinks the map is broken without a key will go and
 * buy one they did not need.
 *
 * **The key is write-only.** It is stored encrypted and never sent back, so
 * this form can say whether one exists and nothing more (ADR-0014 §3). That is
 * stricter than it looks for a *maps* key: Directions bills per request, so a
 * key that leaks into a browser bundle is somebody else's traffic on this
 * operator's invoice, and there is nothing to reset that does not also break
 * the feature.
 *
 * **The switch is separate from the key, and starts off.** Configuring a
 * credential must never silently start a bill, and stopping the spend must not
 * mean destroying the credential and having to find it again.
 */
function MapsCard({ maps, onSaved }: { maps: Settings['maps']; onSaved: (s: Settings) => void }) {
  const [enabled, setEnabled] = useState(maps.routing_enabled)
  const [provider, setProvider] = useState(maps.routing_provider)
  const [osrmUrl, setOsrmUrl] = useState(maps.osrm_base_url)
  const [apiKey, setApiKey] = useState('')
  const { state, errors, message, setMessage, save } = useSave('maps', onSaved)

  return (
    <Card
      title="Maps and routing"
      subtitle="Road routing for the Driver App. The maps themselves are free and need nothing here — this is the route line, the road distance and the arrival estimate."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(
            withSecrets(
              {
                routing_enabled: enabled,
                routing_provider: provider,
                osrm_base_url: osrmUrl,
              },
              { api_key: apiKey },
            ),
          )
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Maps and routing" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        {provider === 'google' ? (
          <Alert tone="info" title="This one costs money per trip">
            Google charges for every route it calculates, so this is the one setting on
            this page with a running cost attached. It buys live traffic, which is the
            whole difference from OSRM below.
          </Alert>
        ) : (
          <Alert tone="info" title="Free, and not yet ready for a real fleet">
            OSRM needs no key and costs nothing, so routing works as soon as you turn it
            on. It routes on road geometry rather than live traffic, so its arrival
            times read optimistic in rush hour. The default address is the project&rsquo;s
            public demo server, which is rate-limited and not meant for production —
            run your own before drivers depend on it.
          </Alert>
        )}

        <FormField
          label="Routing engine"
          htmlFor="settings-maps-provider"
          hint="OSRM is free and needs no account. Google costs per route and adds live traffic."
          error={errors.routing_provider}
        >
          <Select
            id="settings-maps-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'google' | 'osrm')}
          >
            <option value="osrm">OSRM — free, no key</option>
            <option value="google">Google Directions — paid, live traffic</option>
          </Select>
        </FormField>

        <Checkbox
          label="Calculate routes with Google"
          hint="Off keeps the key stored but makes no requests, so the spend stops without you having to find the credential again."
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />

        {provider === 'osrm' && (
          <FormField
            label="OSRM server address"
            htmlFor="settings-maps-osrm"
            hint="Change this to your own instance before a real fleet depends on it."
            error={errors.osrm_base_url}
            required
          >
            <Input
              id="settings-maps-osrm"
              type="url"
              value={osrmUrl}
              onChange={(e) => setOsrmUrl(e.target.value)}
              required
            />
          </FormField>
        )}

        {provider === 'google' && (
        <SecretField
          label="Google Directions API key"
          htmlFor="settings-maps-api-key"
          secret={maps.api_key}
          value={apiKey}
          onChange={setApiKey}
          error={errors.api_key}
        />
        )}

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

/**
 * The two notices the Driver App asks for consent to before it will create an
 * account (ADR-0014, `legal` group).
 *
 * These live in settings rather than in a marketing page because of who has to
 * be able to change them and how fast: a wrong privacy notice is a regulatory
 * problem under the Data Protection and Privacy Act, 2019, and waiting for a
 * release to correct one is not an answer. Saving here changes what the next
 * driver reads, immediately.
 */
function LegalCard({
  legal,
  onSaved,
}: {
  legal: Settings['legal']
  onSaved: (s: Settings) => void
}) {
  const [terms, setTerms] = useState(legal.terms ?? '')
  const [privacy, setPrivacy] = useState(legal.privacy ?? '')
  const { state, errors, message, setMessage, save } = useSave('legal', onSaved)

  return (
    <Card
      title="Terms and privacy"
      subtitle="Shown in the Driver App's sign-up form, which will not create an account until a driver accepts both. Plain text — a blank line starts a new paragraph."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save({ terms, privacy })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Terms and privacy" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <FormField
          label="Terms and Conditions"
          htmlFor="settings-terms"
          hint="What a driver is agreeing to do, and what KangaruRide agrees to in return."
          error={errors.terms}
        >
          <Textarea
            id="settings-terms"
            rows={14}
            value={terms}
            invalid={errors.terms !== undefined}
            onChange={(e) => setTerms(e.target.value)}
          />
        </FormField>

        <FormField
          label="Privacy Policy"
          htmlFor="settings-privacy"
          hint="What personal data is collected, why, who it is shared with, and how a driver asks to see or delete it. Required by the Data Protection and Privacy Act, 2019."
          error={errors.privacy}
        >
          <Textarea
            id="settings-privacy"
            rows={14}
            value={privacy}
            invalid={errors.privacy !== undefined}
            onChange={(e) => setPrivacy(e.target.value)}
          />
        </FormField>

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

/**
 * Which ways into the Driver App are on (ADR-0028).
 *
 * The three switches are what the app's welcome screen renders from —
 * fail-closed, so turning one off here removes the button from every phone
 * within a settings-cache refresh, no release involved. The credential
 * fields exist because the switches are worthless without them: the server
 * refuses tokens minted for anybody else's app.
 */
function AuthMethodsCard({
  auth,
  mailEnabled,
  onSaved,
}: {
  auth: Settings['auth']
  mailEnabled: boolean
  onSaved: (s: Settings) => void
}) {
  const [resetEnabled, setResetEnabled] = useState(auth.password_reset_enabled)
  const [googleEnabled, setGoogleEnabled] = useState(auth.google_enabled)
  const [facebookEnabled, setFacebookEnabled] = useState(auth.facebook_enabled)
  const [googleClientIds, setGoogleClientIds] = useState(auth.google_client_ids ?? '')
  const [facebookAppId, setFacebookAppId] = useState(auth.facebook_app_id ?? '')
  const [facebookAppSecret, setFacebookAppSecret] = useState('')
  const { state, errors, message, setMessage, save } = useSave('auth', onSaved)

  return (
    <Card
      title="Sign-in methods"
      subtitle="What the Driver App offers on its welcome screen. Each switch takes effect on every phone without a release."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setFacebookAppSecret('')
          void save(
            withSecrets(
              {
                password_reset_enabled: resetEnabled,
                google_enabled: googleEnabled,
                facebook_enabled: facebookEnabled,
                google_client_ids: googleClientIds || null,
                facebook_app_id: facebookAppId || null,
              },
              { facebook_app_secret: facebookAppSecret },
            ),
          )
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Sign-in methods" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <Checkbox
          label="Password reset by emailed code"
          hint={
            mailEnabled
              ? 'Drivers who forget their password get a six-digit code by email, valid for fifteen minutes. A successful reset signs them out everywhere.'
              : 'Needs the SMTP settings above configured and enabled first — until then this switch is saved but inert, and the app keeps telling drivers to call the office.'
          }
          checked={resetEnabled}
          onChange={(e) => setResetEnabled(e.target.checked)}
        />

        <Checkbox
          label="Continue with Google"
          hint="Signs existing drivers in with their Google account; a stranger is routed into the application queue, never straight to an account."
          checked={googleEnabled}
          onChange={(e) => setGoogleEnabled(e.target.checked)}
        />

        <FormField
          label="Google client IDs"
          htmlFor="settings-auth-google-ids"
          hint="Comma-separated OAuth client IDs from Google Cloud Console (Android, iOS, web). The server refuses sign-ins minted for any other app."
          error={errors.google_client_ids}
        >
          <Input
            id="settings-auth-google-ids"
            placeholder="1234-abc.apps.googleusercontent.com, 1234-def.apps.googleusercontent.com"
            autoComplete="off"
            value={googleClientIds}
            onChange={(e) => setGoogleClientIds(e.target.value)}
          />
        </FormField>

        <Checkbox
          label="Continue with Facebook"
          hint="Same rules as Google: existing drivers sign in, strangers are routed to the application queue."
          checked={facebookEnabled}
          onChange={(e) => setFacebookEnabled(e.target.checked)}
        />

        <FormField
          label="Facebook app ID"
          htmlFor="settings-auth-fb-id"
          hint="From Meta for Developers."
          error={errors.facebook_app_id}
        >
          <Input
            id="settings-auth-fb-id"
            autoComplete="off"
            value={facebookAppId}
            onChange={(e) => setFacebookAppId(e.target.value)}
          />
        </FormField>

        <SecretField
          label="Facebook app secret"
          htmlFor="settings-auth-fb-secret"
          secret={auth.facebook_app_secret}
          value={facebookAppSecret}
          onChange={setFacebookAppSecret}
          error={errors.facebook_app_secret}
        />

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

/**
 * What the platform keeps, and what it pays out (`billing` group).
 *
 * The group has existed since ADR-0029 and gained the bonus keys in ADR-0034;
 * neither shipped a card, so both were reachable only by an API client. An
 * unreachable setting is not a setting.
 *
 * **The commission rate is never applied retroactively.** ADR-0029 §3 writes
 * the rate in force into each ledger entry's own description, so changing it
 * here moves future work only — the hint says so, because a rate field with no
 * such assurance reads as one that restates last month's pay.
 */
function BillingCard({
  billing,
  onSaved,
}: {
  billing: Settings['billing']
  onSaved: (s: Settings) => void
}) {
  const [commission, setCommission] = useState(String(billing.driver_commission_percent))
  const [bonusEnabled, setBonusEnabled] = useState(billing.bonus_enabled)
  const [target, setTarget] = useState(String(billing.bonus_weekly_trip_target))
  const [amount, setAmount] = useState(String(billing.bonus_weekly_amount_minor))
  const { state, errors, message, setMessage, save } = useSave('billing', onSaved)

  return (
    <Card
      title="Driver pay"
      subtitle="What the platform keeps from a fare, and the weekly bonus. Changes apply to future work only — every ledger entry records the rate that was in force when it was written."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save({
            driver_commission_percent: Number(commission),
            bonus_enabled: bonusEnabled,
            bonus_weekly_trip_target: Number(target),
            bonus_weekly_amount_minor: Number(amount),
          })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Driver pay" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <FormField
          label="Commission the platform keeps (%)"
          htmlFor="settings-commission"
          hint="Taken from every walk-in fare and every tip. The driver keeps the rest; a fraction of a shilling rounds in their favour."
          error={errors.driver_commission_percent}
          required
        >
          <Input
            id="settings-commission"
            type="number"
            min={0}
            max={100}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            required
            style={{ maxWidth: 120 }}
          />
        </FormField>

        <Checkbox
          label="Award a weekly bonus"
          hint="Off by default, and deliberately: a scheme that switches itself on at deploy is an unbudgeted liability against every driver. Awarded by a scheduled job over a finished week, never mid-week."
          checked={bonusEnabled}
          onChange={(e) => setBonusEnabled(e.target.checked)}
        />

        <FormField
          label="Trips needed in a week"
          htmlFor="settings-bonus-target"
          hint="Completed trips inside one closed week."
          error={errors.bonus_weekly_trip_target}
          required
        >
          <Input
            id="settings-bonus-target"
            type="number"
            min={1}
            max={1000}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
            style={{ maxWidth: 120 }}
          />
        </FormField>

        <FormField
          label="Bonus amount"
          htmlFor="settings-bonus-amount"
          hint="In whole shillings. No commission is taken from a bonus — the figure advertised is the figure paid."
          error={errors.bonus_weekly_amount_minor}
          required
        >
          <Input
            id="settings-bonus-amount"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            style={{ maxWidth: 160 }}
          />
        </FormField>

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

/**
 * Whether an odometer reading is believed (`tracking` group, ADR-0035).
 *
 * Both numbers were unreachable before this card: the threshold lived in
 * `config/tracking.php` behind an env var, and the ceiling did not exist. A
 * driver typed one digit too many and the platform priced a 90,004 km journey
 * at UGX 198,013,800 without objecting.
 *
 * The rest of `config/tracking.php` is deliberately not here. Retention,
 * partition headroom and the GPS noise floor are properties of the measuring
 * apparatus rather than business rules, and a noise floor in an admin form is
 * an invitation to break distance measurement for the whole fleet.
 */
function TrackingCard({
  tracking,
  onSaved,
}: {
  tracking: Settings['tracking']
  onSaved: (s: Settings) => void
}) {
  const [threshold, setThreshold] = useState(String(tracking.variance_threshold_percent))
  const [ceiling, setCeiling] = useState(String(tracking.odometer_max_km_per_trip))
  const { state, errors, message, setMessage, save } = useSave('tracking', onSaved)

  return (
    <Card
      title="Distance checks"
      subtitle="How far a single trip may plausibly be, and how far the odometer may disagree with the GPS trace before somebody looks at it."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save({
            variance_threshold_percent: Number(threshold),
            odometer_max_km_per_trip: Number(ceiling),
          })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Distance checks" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <FormField
          label="Longest single trip (km)"
          htmlFor="settings-odometer-ceiling"
          hint="A closing odometer reading beyond this is refused outright, so the driver corrects it while they are still at the vehicle. Set it above your longest real journey — this catches mistyped digits, it does not judge long-distance work."
          error={errors.odometer_max_km_per_trip}
          required
        >
          <Input
            id="settings-odometer-ceiling"
            type="number"
            min={1}
            max={100000}
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
            required
            style={{ maxWidth: 160 }}
          />
        </FormField>

        <FormField
          label="Flag a trip when the readings differ by more than (%)"
          htmlFor="settings-variance-threshold"
          hint="Compared against the GPS trace at completion. Lower catches more and flags more; a queue nobody can keep up with is one nobody reads. A trip with no GPS trace is never flagged — that is missing evidence, not a discrepancy."
          error={errors.variance_threshold_percent}
          required
        >
          <Input
            id="settings-variance-threshold"
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            required
            style={{ maxWidth: 120 }}
          />
        </FormField>

        <Alert tone="info" title="This only flags — it does not stop anything">
          A flagged trip is still invoiced and still pays the driver. Reviewing
          flagged trips is a manual job today, and the fare is priced from the
          odometer rather than the GPS trace.
        </Alert>

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

function MailCard({ mail, onSaved }: { mail: Settings['mail']; onSaved: (s: Settings) => void }) {
  const [enabled, setEnabled] = useState(mail.enabled)
  const [host, setHost] = useState(mail.host ?? '')
  const [port, setPort] = useState(String(mail.port))
  const [username, setUsername] = useState(mail.username ?? '')
  const [password, setPassword] = useState('')
  const [encryption, setEncryption] = useState<'tls' | 'none'>(mail.encryption)
  const [fromAddress, setFromAddress] = useState(mail.from_address ?? '')
  const [fromName, setFromName] = useState(mail.from_name ?? '')
  const { state, errors, message, setMessage, save } = useSave('mail', onSaved)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const sendTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await apiClient.post('/settings/mail/test', {})
      setTestResult({ ok: true, text: response.data.message as string })
    } catch (failure) {
      setTestResult({
        ok: false,
        text: apiError(failure, 'Could not send the test email.').message,
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card
      title="Email (SMTP)"
      subtitle="How the platform sends email. Required before customer password reset can ship."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setPassword('')
          void save(
            withSecrets(
              {
                enabled,
                host: host || null,
                port: Number(port),
                username: username || null,
                encryption,
                from_address: fromAddress || null,
                from_name: fromName || null,
              },
              { password },
            ),
          )
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Email" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <Checkbox
          label="Send email through this SMTP server"
          hint="Off, the platform writes email to its log instead of sending — the safe default until the settings below are proven by a test send."
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>
          <FormField label="SMTP host" htmlFor="settings-mail-host" error={errors.host}>
            <Input
              id="settings-mail-host"
              placeholder="smtp.your-provider.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </FormField>
          <FormField label="Port" htmlFor="settings-mail-port" error={errors.port} required>
            <Input
              id="settings-mail-port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              required
            />
          </FormField>
        </div>

        <FormField label="Username" htmlFor="settings-mail-username" error={errors.username}>
          <Input
            id="settings-mail-username"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </FormField>

        <SecretField
          label="Password"
          htmlFor="settings-mail-password"
          secret={mail.password}
          value={password}
          onChange={setPassword}
          error={errors.password}
        />

        <FormField label="Encryption" htmlFor="settings-mail-encryption" error={errors.encryption} required>
          <Select
            id="settings-mail-encryption"
            value={encryption}
            onChange={(e) => setEncryption(e.target.value as 'tls' | 'none')}
            options={[
              { value: 'tls', label: 'TLS (standard)' },
              { value: 'none', label: 'None (unencrypted — local relay only)' },
            ]}
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <FormField label="From address" htmlFor="settings-mail-from" error={errors.from_address}>
            <Input
              id="settings-mail-from"
              type="email"
              iconLeft="mail"
              placeholder="noreply@kangaruride.com"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
            />
          </FormField>
          <FormField label="From name" htmlFor="settings-mail-from-name" error={errors.from_name}>
            <Input
              id="settings-mail-from-name"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
          </FormField>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <SaveButton state={state} />
          <Button
            type="button"
            variant="secondary"
            iconLeft="send"
            disabled={testing}
            onClick={() => void sendTest()}
          >
            {testing ? 'Sending…' : 'Send test email'}
          </Button>
        </div>

        {testResult !== null && (
          <Alert
            tone={testResult.ok ? 'success' : 'error'}
            title={testResult.ok ? 'Test email' : 'Test failed'}
            onDismiss={() => setTestResult(null)}
          >
            {testResult.text}
          </Alert>
        )}
      </form>
    </Card>
  )
}

function SmsCard({ sms, onSaved }: { sms: Settings['sms']; onSaved: (s: Settings) => void }) {
  const [provider, setProvider] = useState(sms.provider ?? '')
  const [senderId, setSenderId] = useState(sms.sender_id ?? '')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const { state, errors, message, setMessage, save } = useSave('sms', onSaved)

  return (
    <Card
      title="SMS gateway"
      subtitle="Credentials stored for the SMS launch. Nothing sends SMS yet — switching messaging on is a separate decision, made deliberately because SMS fraud is a real cost here."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setApiKey('')
          setApiSecret('')
          void save(
            withSecrets(
              { provider: provider || null, sender_id: senderId || null },
              { api_key: apiKey, api_secret: apiSecret },
            ),
          )
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="SMS gateway" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <FormField label="Provider" htmlFor="settings-sms-provider" error={errors.provider}>
            <Select
              id="settings-sms-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              placeholder="Not chosen yet"
              options={[
                { value: 'africastalking', label: "Africa's Talking" },
                { value: 'twilio', label: 'Twilio' },
              ]}
            />
          </FormField>
          <FormField
            label="Sender ID"
            htmlFor="settings-sms-sender"
            hint="The name recipients see, as registered with the provider."
            error={errors.sender_id}
          >
            <Input
              id="settings-sms-sender"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
            />
          </FormField>
        </div>

        <SecretField
          label="API key"
          htmlFor="settings-sms-key"
          secret={sms.api_key}
          value={apiKey}
          onChange={setApiKey}
          error={errors.api_key}
        />
        <SecretField
          label="API secret"
          htmlFor="settings-sms-secret"
          secret={sms.api_secret}
          value={apiSecret}
          onChange={setApiSecret}
          error={errors.api_secret}
        />

        <SaveButton state={state} />
      </form>
    </Card>
  )
}

function PaymentsCard({
  payments,
  onSaved,
}: {
  payments: Settings['payments']
  onSaved: (s: Settings) => void
}) {
  const [mtnUser, setMtnUser] = useState(payments.mtn_momo_api_user ?? '')
  const [mtnKey, setMtnKey] = useState('')
  const [airtelId, setAirtelId] = useState(payments.airtel_money_client_id ?? '')
  const [airtelSecret, setAirtelSecret] = useState('')
  const { state, errors, message, setMessage, save } = useSave('payments', onSaved)

  return (
    <Card
      title="Payment gateways"
      subtitle="Credential slots for the payments launch. Nothing charges anyone yet — enabling payments is its own project with its own decision record."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setMtnKey('')
          setAirtelSecret('')
          void save(
            withSecrets(
              {
                mtn_momo_api_user: mtnUser || null,
                airtel_money_client_id: airtelId || null,
              },
              { mtn_momo_api_key: mtnKey, airtel_money_client_secret: airtelSecret },
            ),
          )
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {message !== null && (
          <Alert tone="error" title="Payment gateways" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        <FormField label="MTN MoMo API user" htmlFor="settings-mtn-user" error={errors.mtn_momo_api_user}>
          <Input
            id="settings-mtn-user"
            autoComplete="off"
            value={mtnUser}
            onChange={(e) => setMtnUser(e.target.value)}
          />
        </FormField>
        <SecretField
          label="MTN MoMo API key"
          htmlFor="settings-mtn-key"
          secret={payments.mtn_momo_api_key}
          value={mtnKey}
          onChange={setMtnKey}
          error={errors.mtn_momo_api_key}
        />

        <FormField
          label="Airtel Money client ID"
          htmlFor="settings-airtel-id"
          error={errors.airtel_money_client_id}
        >
          <Input
            id="settings-airtel-id"
            autoComplete="off"
            value={airtelId}
            onChange={(e) => setAirtelId(e.target.value)}
          />
        </FormField>
        <SecretField
          label="Airtel Money client secret"
          htmlFor="settings-airtel-secret"
          secret={payments.airtel_money_client_secret}
          value={airtelSecret}
          onChange={setAirtelSecret}
          error={errors.airtel_money_client_secret}
        />

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
