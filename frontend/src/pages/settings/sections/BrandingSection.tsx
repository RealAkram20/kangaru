import { useRef, useState } from 'react'
import { Button } from '../../../components/core/Button'
import { Input } from '../../../components/forms/Input'
import { apiClient } from '../../../lib/apiClient'
import { apiError } from '../../../lib/apiError'
import { Row, SectionForm } from '../kit'
import { orNull, useSectionState } from '../state'
import type { SectionProps, Settings } from '../types'

/** The public disk's URL for a stored asset path, cross-origin safe. */
function assetUrl(path: string | null): string | null {
  if (!path) return null
  return `${new URL(import.meta.env.VITE_API_BASE_URL).origin}/storage/${path}`
}

export function BrandingSection({ settings, onSaved, section }: SectionProps) {
  const branding = settings.branding
  const state = useSectionState({
    app_name: branding.app_name,
    tagline: branding.tagline ?? '',
    meta_description: branding.meta_description ?? '',
    contact_email: branding.contact_email,
    contact_phone: branding.contact_phone ?? '',
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      payload={() => ({
        app_name: value.app_name,
        tagline: orNull(value.tagline),
        meta_description: orNull(value.meta_description),
        contact_email: value.contact_email,
        contact_phone: orNull(value.contact_phone),
      })}
    >
      {(errors) => (
        <>
          <Row label="App name" htmlFor="settings-app-name" error={errors.app_name} required control={380}>
            <Input
              id="settings-app-name"
              value={value.app_name}
              onChange={(event) => set('app_name', event.target.value)}
              required
            />
          </Row>

          <Row label="Tagline" htmlFor="settings-tagline" error={errors.tagline} control={380}>
            <Input
              id="settings-tagline"
              value={value.tagline}
              onChange={(event) => set('tagline', event.target.value)}
            />
          </Row>

          <Row
            label="Meta description"
            htmlFor="settings-meta"
            hint="Shown under the name in search results."
            error={errors.meta_description}
          >
            <Input
              id="settings-meta"
              value={value.meta_description}
              onChange={(event) => set('meta_description', event.target.value)}
            />
          </Row>

          <Row
            label="Contact email"
            htmlFor="settings-contact-email"
            error={errors.contact_email}
            required
            control={380}
          >
            <Input
              id="settings-contact-email"
              type="email"
              iconLeft="mail"
              value={value.contact_email}
              onChange={(event) => set('contact_email', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Contact phone"
            htmlFor="settings-contact-phone"
            error={errors.contact_phone}
            control={380}
          >
            <Input
              id="settings-contact-phone"
              iconLeft="phone"
              value={value.contact_phone}
              onChange={(event) => set('contact_phone', event.target.value)}
            />
          </Row>

          {/*
            The two uploads save on choosing a file rather than on this
            section's button — they are their own endpoint, and a file that
            sat unsent behind a Save nobody pressed would be the worse
            surprise. Their labels are plain text, not a `<label htmlFor>`:
            the control is a hidden file input driven by a button, and a label
            pointing at it would open the file picker on a stray click.
          */}
          <AssetRow
            label="Logo"
            hint="PNG, JPG, SVG or WebP · up to 2 MB"
            asset="logo"
            currentPath={branding.logo_path}
            onSaved={onSaved}
          />
          <AssetRow
            label="Favicon"
            hint="PNG, ICO or SVG · up to 512 KB"
            asset="favicon"
            currentPath={branding.favicon_path}
            onSaved={onSaved}
          />
        </>
      )}
    </SectionForm>
  )
}

function AssetRow({
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
  onSaved: (settings: Settings) => void
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
    <div className="kr-setting-row kr-field-split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ font: 'var(--type-label)', color: 'var(--text-body)' }}>{label}</span>
        <p style={{ font: 'var(--type-caption)', color: problem ? 'var(--kr-error)' : 'var(--text-secondary)' }}>
          {problem ?? hint}
        </p>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          maxWidth: 380,
          padding: 'var(--space-3)',
          border: '1px dashed var(--border-input)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--surface-sunken)',
        }}
      >
        {url ? (
          <img src={url} alt="" style={{ height: 32, maxWidth: 96, objectFit: 'contain' }} />
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
          style={{ marginLeft: 'auto' }}
        >
          {uploading ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          aria-label={`Upload ${label.toLowerCase()}`}
          accept={asset === 'logo' ? '.png,.jpg,.jpeg,.svg,.webp' : '.png,.ico,.svg'}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
