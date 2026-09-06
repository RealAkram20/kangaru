import { apiClient } from './apiClient'

/**
 * The public branding subset (ADR-0014 §5): what the document head, the
 * landing page and the login screen read instead of hard-coding the
 * brand. Fails soft to the compiled-in defaults — a misconfigured
 * backend degrades to the current look, never to a blank page.
 */
export interface PublicSettings {
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
  }
  ordering: {
    /** False while the owner has paused online intake — explain, don't fail at submit. */
    walk_in_enabled: boolean
  }
  auth: {
    /**
     * Whether the emailed-code reset flow is on (ADR-0028 §4: the client
     * reads this before showing the flow; the endpoints' 409 is only the
     * backstop for a stale client).
     */
    password_reset_enabled: boolean
  }
}

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  branding: {
    app_name: 'KangaruRide',
    tagline: 'For Safety and Reliability',
    meta_description: null,
    contact_email: 'operations@kangaruride.com',
    contact_phone: null,
    logo_path: null,
    favicon_path: null,
  },
  regional: { currency: 'UGX' },
  ordering: { walk_in_enabled: true },
  // Fail closed, same rule as the driver app: an unreachable server must not
  // offer a door the owner may have switched off.
  auth: { password_reset_enabled: false },
}

let cached: PublicSettings | null = null

export async function fetchPublicSettings(): Promise<PublicSettings> {
  if (cached !== null) return cached
  try {
    const response = await apiClient.get('/public/settings')
    cached = response.data.data.settings as PublicSettings
    return cached
  } catch {
    return DEFAULT_PUBLIC_SETTINGS
  }
}

/**
 * Stamps the browser chrome — title, meta description, favicon — from
 * settings. Called once at app start; safe to call again (idempotent).
 */
export async function applyBrandingHead(): Promise<void> {
  const { branding } = await fetchPublicSettings()

  if (branding.app_name) {
    document.title = branding.tagline
      ? `${branding.app_name} — ${branding.tagline}`
      : branding.app_name
  }

  if (branding.meta_description) {
    let meta = document.querySelector('meta[name="description"]')
    if (meta === null) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', branding.meta_description)
  }

  if (branding.favicon_path) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link === null) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = branding.favicon_path
  }
}
