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
   * The vehicle they drive, or null when the depot allocates one per shift.
   */
  vehicle_id: number | null
  /**
   * Whether `vehicle_id` is **theirs** (ADR-0048 §7).
   *
   * Not derivable from `vehicle_id`: a boda rider whose machine is their
   * livelihood and a driver holding the keys to a depot car this week both set
   * that column. The pair `owns_vehicle: true, vehicle_id: null` is real and
   * meaningful — a driver recorded as owning a machine the fleet has not
   * registered yet.
   */
  owns_vehicle: boolean
  /**
   * Enough of the vehicle to name it on a row, and no more.
   *
   * **Optional, not nullable-and-required**: the server sends it only when the
   * relation was eager-loaded, so a missing key means "not asked for" and null
   * means "no vehicle". A list that stopped eager-loading would then show a
   * visibly missing plate in development rather than being quietly slow in
   * production.
   */
  vehicle?: DriverVehicle | null
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

/** The flat vehicle summary a driver row carries. */
export interface DriverVehicle {
  id: number
  registration_number: string
  make: string
  model: string
}

export interface DriverAccount {
  id: number
  email: string
  role: string
  status: 'active' | 'suspended'
}
