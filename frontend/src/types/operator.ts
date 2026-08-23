/** A fleet company, as head office reads it (ADR-0055, ADR-0059). */
export interface Operator {
  id: number
  name: string
  slug: string
  status: 'active' | 'suspended'
  is_active: boolean
  /**
   * What this fleet pays to be on Kangaru (ADR-0058). Absent when the
   * relation was not loaded; never null on a loaded fleet — a fleet with no
   * plan is a configuration error the API refuses, not a state to render.
   */
  plan?: { id: number; name: string; is_default: boolean }
  /** Staff and drivers both — every account whose fleet this is. */
  users_count?: number
  drivers_count?: number
  vehicles_count?: number
  /** Corporate clients under contract (ADR-0055 §6). */
  clients_count?: number
  created_at: string | null
}

/** What onboarding asks for. The owner is required, not optional — ADR-0059 §5. */
export interface OperatorInput {
  name: string
  owner_name: string
  owner_email: string
}
