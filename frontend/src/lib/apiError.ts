import axios from 'axios'
import type { ApiError } from '../types/api'

/**
 * Pulls the backend's failure envelope off an axios error.
 *
 * The backend guarantees a stable machine-readable `code` and a message
 * already written for a human (AGENTS.md Error Handling), so the message is
 * shown as-is rather than being re-worded here — re-wording it in the client
 * is how the two drift apart and how a dispatcher ends up reading
 * "Something went wrong" instead of which trip has their vehicle.
 */
export function apiError(error: unknown, fallback: string): ApiError {
  if (axios.isAxiosError(error) && error.response?.data && typeof error.response.data === 'object') {
    const data = error.response.data as Partial<ApiError>
    if (data.success === false && typeof data.code === 'string') {
      return {
        success: false,
        code: data.code,
        message: data.message ?? fallback,
        errors: data.errors ?? {},
      }
    }
  }

  // A network failure or a non-envelope 5xx — there is no server `code` to
  // report, so callers get a synthetic one they can still branch on.
  return { success: false, code: 'NETWORK_ERROR', message: fallback, errors: {} }
}

/** First validation message per field, for wiring 422s into FormField. */
export function fieldErrors(error: ApiError): Record<string, string> {
  return Object.fromEntries(
    Object.entries(error.errors).map(([field, messages]) => [field, messages[0] ?? '']),
  )
}
