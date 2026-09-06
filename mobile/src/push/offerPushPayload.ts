/**
 * Reading a push out of what `expo-notifications` hands a background task.
 *
 * ## Why this is its own module, and pure
 *
 * Because it is the only part of the headless path a test can reach.
 * `offerPushTask` runs in a JavaScript context the operating system created
 * for one FCM message, with no React tree, no navigator and no way to reach
 * it from Jest. What *can* be tested is the shape-reading, and the shape is
 * exactly where this path breaks: the payload a background task receives is
 * **not** the payload a foreground listener receives, and the difference is
 * undocumented enough that getting it wrong produces a task that runs
 * perfectly and decides "ignore" every time.
 *
 * That failure has no symptom. The driver gets the plain push — which is what
 * they get today — so a broken parser here is indistinguishable from the
 * feature not being built.
 *
 * ## The two shapes, and why only one is ours to act on
 *
 * `NotificationTaskPayload` is a union. On Android the task is called both
 * when a notification **arrives** and when a driver **taps an action** on one
 * while the app is backgrounded or terminated:
 *
 * - **Arrival** — `{ notification, data }`. This is the one that matters: it
 *   is the only moment where the driver has not yet looked at the phone, and
 *   the whole feature is about what happens before they do.
 * - **A response** — a `NotificationResponse`, carrying `actionIdentifier`.
 *   Already handled, twice over: notify-kit's `onBackgroundEvent` answers the
 *   call notification's own Accept and Decline, and `PushRouter` handles taps
 *   on the plain push. Acting on it here would be a third answer to one
 *   press, which is the double-accept `claimAnswer` exists to catch.
 *
 * So a response yields null and this does nothing with it.
 *
 * ## Why `dataString` is tried before `data`
 *
 * Because Android's transport stringifies notification extras, and Expo
 * surfaces that as `dataString` — a JSON string sitting *beside* the loose
 * fields rather than instead of them. Which of the two is populated has
 * varied across SDK versions and across the notification/data split in FCM,
 * so this reads whichever is actually there instead of betting on one.
 *
 * `routing.ts` already accepts both a number and a string for `offer_id` for
 * the same underlying reason. This is that defence one layer out.
 */

/** The JSON-string fields Expo has been observed to nest the payload under. */
const NESTED_KEYS = ['dataString', 'body'] as const;

/**
 * The push's `data`, or null when there is nothing here to act on.
 *
 * Returns `unknown` rather than a narrowed type on purpose: `intentFrom` is
 * the one place in this app that decides what a payload *means*, and handing
 * it a pre-narrowed object would put a second opinion about push shapes in a
 * second file. This finds the object; `routing.ts` reads it.
 */
export function pushDataFromTaskPayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  // A driver pressing a button, not a job arriving. See the docblock.
  if ('actionIdentifier' in payload) {
    return null;
  }

  const data = (payload as { data?: unknown }).data;

  if (data === null || typeof data !== 'object') {
    return null;
  }

  const fields = data as Record<string, unknown>;

  for (const key of NESTED_KEYS) {
    const nested = parseObject(fields[key]);

    if (nested !== null) {
      return nested;
    }
  }

  return fields;
}

/**
 * A JSON string containing an object, parsed — or null for anything else.
 *
 * Anything else includes a JSON string containing an array or a number, which
 * parse successfully and are not payloads. Returning them would hand
 * `intentFrom` something it would correctly ignore, but only after this file
 * had stopped looking for the real payload beside it.
 */
function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Not JSON. An ordinary shape for `body` on a notification that is not
    // ours, and the loose fields beside it are still worth reading.
    return null;
  }
}
