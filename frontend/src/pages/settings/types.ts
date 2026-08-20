import type { SectionMeta } from './state'

/**
 * The shape of `GET /settings` (ADR-0014).
 *
 * One key per group, and the group name is also the PATCH path segment:
 * `PATCH /settings/{group}` takes the whole group, so a card that edits one
 * field still sends every other field in its group back unchanged.
 */
export interface Settings {
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
  /** ADR-0029 §3, widened by ADR-0034, ADR-0036 and ADR-0037. */
  billing: {
    driver_commission_percent: number
    bonus_enabled: boolean
    bonus_weekly_trip_target: number
    bonus_weekly_amount_minor: number
    /** ADR-0036: the peak-hour uplift on a driver's share. */
    peak_enabled: boolean
    peak_starts_at: string
    peak_ends_at: string
    peak_uplift_percent: number
    /** ADR-0037: what introducing a driver pays, and what it takes. */
    referral_enabled: boolean
    referral_trip_target: number
    referral_reward_amount_minor: number
  }
  /** ADR-0035: the two numbers that decide whether a reading is believed. */
  tracking: {
    odometer_enabled: boolean
    trace_route_ceiling_percent: number
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
export interface SecretValue {
  configured: boolean
}

/**
 * Every section is handed the whole settings object, its own rail entry, and a
 * way to replace the settings.
 *
 * The whole object rather than its own group, because three sections read
 * outside their own: Sign-in methods needs to know whether mail is on before it
 * can say what a reset switch will actually do, Driver pay needs the configured
 * currency for its money fields, and both are the kind of cross-reference an
 * operator would otherwise have to make in their head.
 */
export interface SectionProps {
  settings: Settings
  section: SectionMeta
  onSaved: (settings: Settings) => void
}
