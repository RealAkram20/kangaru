/**
 * Where the API lives.
 *
 * `10.0.2.2` is the Android emulator's route to the host machine, which is
 * where a developer's `php artisan serve` is listening. A physical handset on
 * the depot wifi needs the machine's LAN address instead, which is what the
 * environment variable is for:
 *
 *   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000/api/v1 npx expo start
 *
 * Expo inlines `EXPO_PUBLIC_*` at build time, so this is a build-time choice,
 * not a runtime one — which is right for a URL that differs per environment
 * and must not be editable on a device in the field.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:8000/api/v1';

/**
 * How often the trip list refreshes while the app is open.
 *
 * Push now reaches the device too (ADR-0046), so this is no longer the only
 * way a new assignment arrives — but it stays exactly as it is, because
 * ADR-0025 §3 makes push best-effort and this is the path that works for a
 * driver who refused the permission or whose token went stale. The interval is
 * a deliberate trade rather than a default:
 *
 * - **60 seconds, foreground only.** A dispatcher's assignment reaches the
 *   driver within a minute of them looking at the phone.
 * - **The cost.** ~60 requests an hour, each a small cursor page. The radio
 *   wake is the expense, not the bytes; at this interval it coincides with
 *   traffic the handset is generating anyway and adds low single-digit
 *   percentage points to hourly drain. Ten seconds would roughly quadruple
 *   that for a signal that changes a few times a shift.
 * - **This one does not poll in the background**, even now that the process
 *   survives there. A trip assigned by a dispatcher is work for later today,
 *   and waking the radio for it while the phone is in a pocket spends a
 *   shift's battery on a signal that changes a few times a day. The offer
 *   poll is the one that earns background time, because it has a passenger
 *   standing at the end of it.
 */
export const TRIP_POLL_INTERVAL_MS = 60_000;

/** How often the outbox retries while the app is open and online. */
export const OUTBOX_TICK_INTERVAL_MS = 15_000;

/**
 * How often the job-offer list refreshes while the driver is on duty.
 *
 * Far faster than `TRIP_POLL_INTERVAL_MS`, and the two are different numbers
 * because they answer different questions. A trip assigned by a dispatcher is
 * work for later today, and a minute's delay costs nothing. An offer is a
 * forty-five-second countdown (`dispatch.offer_ttl_seconds`) with a passenger
 * standing on a kerb at the end of it — poll that once a minute and the offer
 * has expired before the driver ever sees it.
 *
 * Five seconds is chosen against that window rather than against battery, and
 * it is deliberately not relaxed now that the window is longer: the number to
 * protect is how much of their clock a driver gets to *use*, and a job seen
 * five seconds late is five seconds they do not get back whatever the window
 * is.
 *
 * The cost is bounded by *when* it runs. This polls only while the driver is
 * on duty — a driver who signs off stops paying for it entirely, which is the
 * whole point of duty being an explicit act.
 *
 * Push is what actually carries an offer now (ADR-0046), which makes this the
 * fallback rather than the mechanism. It stays either way: ADR-0025 §3 makes
 * push best-effort, because a driver can refuse the OS permission and
 * ADR-0023's thesis is dead zones.
 */
export const OFFER_POLL_INTERVAL_MS = 5_000;

/**
 * How long to wait for a duty or presence write before giving up.
 *
 * Shorter than the app's default, because these are statements about *now*.
 * A "go on duty" that lands after thirty seconds of retrying is a driver who
 * has already put the phone down believing it failed, and a presence ping
 * that old describes somewhere they no longer are.
 */
export const DUTY_REQUEST_TIMEOUT_MS = 10_000;
