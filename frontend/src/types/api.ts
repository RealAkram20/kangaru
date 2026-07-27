/** Matches the backend envelope in AGENTS.md API Standards. */
export interface ApiSuccess<T> {
  success: true
  message: string
  data: T
}

export interface ApiError {
  success: false
  code: string
  message: string
  errors: Record<string, string[]>
}
