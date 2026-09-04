/**
 * What a push means, decided from its data and nothing else (ADR-0046 §4).
 *
 * ## Why the payload is parsed rather than trusted
 *
 * A notification's `data` arrives from outside the app, through two networks
 * and a vendor, and it survives an app update: a push sent by yesterday's
 * server can be tapped by today's build. So this reads field by field and has
 * a defined answer for every shape, including the shapes nothing sends today.
 *
 * The failure it prevents is not a crash — it is a tap that opens nothing. A
 * driver who hears a job, reaches for the phone, taps, and lands on the home
 * screen with no explanation has been told the app is unreliable, and that is
 * a conclusion they only need to reach once.
 *
 * ## Why it is a separate module
 *
 * Because `PushRouter` cannot be tested. It reaches `expo-notifications`,
 * which cannot be imported outside a development build at all, and it runs on
 * a cold start from a killed process — a state no test in this repo can
 * produce. `jest.setup.ts` states the rule this follows: the suites worth
 * trusting here are pure TypeScript over injected ports. This is the part
 * that can be one.
 */

export type PushIntent =
  /** A job is waiting. The overlay is what shows it; this only has to say which. */
  | { kind: 'open_offer'; offerId: number }
  /**
   * That job is gone — taken, cancelled, or expired at the server. Sent so a
   * handset can stop ringing without waiting out its own countdown.
   */
  | { kind: 'withdraw_offer'; offerId: number }
  /** A trip a dispatcher put on this driver's list. */
  | { kind: 'open_trip'; tripId: number }
  /** Anything else, including a push from a newer server than this build. */
  | { kind: 'ignore' };

/**
 * A positive integer, or null.
 *
 * Ids cross the wire as JSON and come back as numbers — but a push payload is
 * stringified by the transport on some Android versions, so `"41"` is a real
 * shape this receives and must accept. What it must not accept is `0`, a
 * negative, a float or `NaN`: each of those builds a URL that 404s, and the
 * driver sees the same nothing as a dropped tap.
 */
function id(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;

  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

/**
 * Reads an intent out of a notification's `data`.
 *
 * Keyed on the ids the server sends rather than on a notification type
 * string. Both would work today; ids are the more honest question, because
 * what this has to decide is *which screen* and the id is what a screen needs.
 * A type name adds a second vocabulary to keep in step across two codebases,
 * and `TripOfferedNotification::context()` already carries `offer_id` for
 * exactly this purpose.
 */
export function intentFrom(data: unknown): PushIntent {
  if (data === null || typeof data !== 'object') {
    return { kind: 'ignore' };
  }

  const fields = data as Record<string, unknown>;

  const offerId = id(fields.offer_id);

  if (offerId !== null) {
    // A withdrawal names the same offer as the ring it is cancelling, so the
    // flag is what separates them — not the presence of the id. Read as an
    // explicit true: a missing flag on an ordinary offer must never be read
    // as a withdrawal, because that would silence the job it was announcing.
    return fields.withdrawn === true || fields.withdrawn === 'true'
      ? { kind: 'withdraw_offer', offerId }
      : { kind: 'open_offer', offerId };
  }

  const tripId = id(fields.trip_id);

  if (tripId !== null) {
    return { kind: 'open_trip', tripId };
  }

  // Deliberately the answer for everything unrecognised, including a payload
  // from a server newer than this build. Guessing would be worse: the guess
  // that goes wrong opens a screen for a job the driver does not have.
  return { kind: 'ignore' };
}
