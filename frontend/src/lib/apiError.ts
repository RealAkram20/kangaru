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

/**
 * The most specific sentence a failure carries: the first field message if
 * there is one, otherwise the envelope's own.
 *
 * For a surface that shows a single banner rather than per-field errors. A
 * `422` carries two messages and only one of them is worth reading: the
 * useful sentence is in `errors`, while `message` is Laravel's "The given
 * data was invalid." Showing the latter turns a considered refusal into what
 * looks like a broken page, and fails AGENTS.md's rule that an error says
 * what happened and what to do next.
 *
 * ADR-0007 is why this exists and why it is shared. Both the financial
 * report and its export answer `422` to a platform user who has not named a
 * client — deliberately, because a total spanning every client is a
 * different figure. Two call sites answering the same refusal is exactly how
 * one of them gets fixed and the other does not, which is what happened: the
 * report read `errors.tenant_id` and the export panel beside it went on
 * printing "The given data was invalid." Keeping the precedence in one place
 * is the point.
 *
 * The fallback matters as much as the preference. `REPORT_TOO_LARGE` and a
 * dropped connection carry no field errors, and their envelope message —
 * which names the trip count and says how to narrow it — is already written
 * for a human, so it must still come through untouched.
 */
export function fieldFirstMessage(error: unknown, fallback: string): string {
  const failure = apiError(error, fallback)
  const [firstFieldMessage] = Object.values(fieldErrors(failure))

  return firstFieldMessage || failure.message
}
