/**
 * Failure codes as the platform defines them.
 *
 * AGENTS.md: "Codes are enumerated in a single ErrorCode enum and documented.
 * Clients branch on `code`, never on message text." This is the app's half of
 * that bargain — the messages beside these codes are written for humans and
 * will be reworded, so nothing in this app may read them.
 *
 * Only the codes the Driver's Application can actually provoke are listed.
 * `App\Enums\ErrorCode` has thirty-odd; a driver token reaches nineteen routes
 * (ADR-0022) and cannot reach billing, roles or reporting at all. An unlisted
 * code still arrives intact as a string — `isApiError` does not validate
 * against this union — it simply has no branch, which is the right outcome for
 * something this app was never meant to see.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'MFA_REQUIRED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'INVALID_TRIP_TRANSITION'
  | 'VEHICLE_UNAVAILABLE'
  | 'DRIVER_UNAVAILABLE'
  | 'AVAILABILITY_ALREADY_ANSWERED'
  | 'NOT_A_DRIVER'
  // ADR-0043. Both are 409s the close-account screen branches on: one open
  // request per driver, and a decided request cannot be withdrawn. The screen
  // reads its own state from `GET me/closure-request`, so these fire only when
  // the office answered between the read and the tap — which is exactly the
  // race a code, rather than a message, exists for.
  | 'CLOSURE_REQUEST_ALREADY_OPEN'
  | 'CLOSURE_REQUEST_ALREADY_DECIDED'
  | 'TOKEN_SCOPE_EXCEEDED';

/** Field-level messages from a 422, keyed by input name. */
export type ValidationErrors = Record<string, string[]>;

/**
 * The server answered, and the answer was a refusal.
 *
 * The distinction from `NetworkError` below is the one the offline outbox is
 * built on: this means the request definitely arrived and definitely did not
 * take effect. Anything ambiguous must not be an ApiError.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly errors: ValidationErrors;
  /** From `Retry-After` on a 429, in seconds. Null when the header was absent. */
  readonly retryAfterSeconds: number | null;

  constructor(args: {
    code: string;
    message: string;
    status: number;
    errors?: ValidationErrors;
    retryAfterSeconds?: number | null;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.code = args.code;
    this.status = args.status;
    this.errors = args.errors ?? {};
    this.retryAfterSeconds = args.retryAfterSeconds ?? null;
  }
}

/**
 * The request may or may not have been applied.
 *
 * A dropped socket, a DNS failure, an abort on timeout. The app cannot tell
 * these from "the write succeeded and the response was lost", and ADR-0023 §2
 * refuses to guess: an outbox item that fails this way is reconciled against
 * the server before it is ever sent again.
 */
export class NetworkError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Whether the outcome of a failed request is unknown.
 *
 * A 5xx counts. A gateway returning 502 says nothing about whether the
 * application server behind it processed the request first, and treating that
 * as a clean failure is how a trip completion gets applied twice.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }

  return isApiError(error) && error.status >= 500;
}

/**
 * Whether it is worth trying this again at all.
 *
 * 401 is absent on purpose: it is retryable in principle but the outbox
 * pauses on it rather than backing off, because nothing will change until the
 * driver signs in again (ADR-0023 §6).
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }

  if (!isApiError(error)) {
    return false;
  }

  return error.status >= 500 || error.status === 429;
}

/**
 * The sentence to put in front of a driver when a request failed.
 *
 * **Written because the honest answer was being thrown away.** Every screen
 * that wrote its own `catch` rendered one connection sentence for every
 * outcome, so a server that had answered — *"That photo is too large"*, *"The
 * file failed to upload"* — was reported as a phone with no signal. That
 * wording sent the owner and two agents hunting a network fault for an upload
 * the office had refused in 80 milliseconds.
 *
 * The three outcomes are genuinely different and are kept apart:
 *
 * - **The office answered.** Its own words, because it knows what was wrong.
 *   A 422's field message is preferred over the envelope's, which is the
 *   framework's *"The given data was invalid."* and tells a driver nothing.
 * - **Nothing arrived.** `offline` — the caller's sentence, because what a
 *   driver should do about it differs by screen (a queued transition is not a
 *   payout detail).
 * - **Neither.** A fault on the handset, said plainly rather than blamed on
 *   the network. It is rare and it is a bug, and mislabelling it as signal is
 *   how it stays one.
 */
export function refusalMessage(error: unknown, offline: string): string {
  if (isApiError(error)) {
    const field = Object.values(error.errors).find((messages) => messages.length > 0);

    return field?.[0] ?? error.message;
  }

  if (error instanceof NetworkError) {
    return offline;
  }

  return 'Something went wrong on this phone. Try again.';
}
