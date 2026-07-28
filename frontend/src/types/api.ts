/** Matches the backend envelope in AGENTS.md API Standards. */
export interface ApiSuccess<T, M = undefined> {
  success: true
  message: string
  data: T
  meta?: M
}

export interface ApiError {
  success: false
  code: string
  message: string
  errors: Record<string, string[]>
}
