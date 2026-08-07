// Platform-level like Vehicle (ADR-0005): a driver works for Shanitah,
// not for a corporate client.
export interface Driver {
  id: number
  name: string
  phone: string
  email: string | null
  license_number: string
  license_expiry: string
  status: 'active' | 'suspended' | 'inactive'
  /**
   * The login this driver signs in with (ADR-0016), or null if they have
   * none and so cannot record a trip.
   *
   * Never optional. The server always sends the key so a screen can tell
   * "no account" apart from "not asked for" — the difference between
   * offering to create one and offering to create a second.
   */
  account: DriverAccount | null
  created_at: string
  updated_at: string
}

export interface DriverAccount {
  id: number
  email: string
  role: string
  status: 'active' | 'suspended'
}
