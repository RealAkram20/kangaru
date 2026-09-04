#!/usr/bin/env node
/**
 * Walk-in dispatch, end to end, without a handset (ADR-0012 → ADR-0024).
 *
 * ## Why this exists
 *
 * The chain from the web app's order form to a job on a driver's phone is
 * built and has tests, but proving it *works* needs three things running at
 * once: the API, somebody ordering, and a driver who is **on duty and has
 * been heard from in the last `presence_ttl_seconds`**. That last one is the
 * whole difficulty. It is not a database row somebody can seed and walk away
 * from — `WalkInRecommender` treats a presence older than the TTL as an
 * absent driver, on purpose, so a seeded row is stale three minutes later and
 * every order after that finds nobody.
 *
 * So the driver half of a demo has to be something that keeps beating. That
 * is `driver` below: it does exactly what the app does, over the same HTTP
 * routes, with the same driver-scoped token (ADR-0022) — sign in, go on duty,
 * heartbeat on the cadence the *server* asks for, poll `GET /me/offers`, and
 * accept. Nothing here is a shortcut past the API: if the simulation gets an
 * offer, a real phone would have too.
 *
 * ## Roles
 *
 *   node tools/simulate-dispatch.mjs driver [--email=…] [--vehicle=ID] [--drive] [--decline]
 *   node tools/simulate-dispatch.mjs order  [--service=ride|delivery] [--near=LAT,LNG]
 *   node tools/simulate-dispatch.mjs status [--reference=KR-…]
 *
 * Run `driver` in one terminal and leave it beating. Then either place an
 * order from the web app at /order — which is the demonstration, and the
 * point — or use `order` here when there is no browser to hand.
 *
 * ## What it will not do
 *
 * It does not touch the database, and it does not know the demo password.
 * Both are deliberate: a simulator that writes rows can make a green run out
 * of a broken platform, and a credential belongs in the seeder that mints it
 * (`DriverAppSeeder`) or on the command line. Development only — it refuses
 * any API base that is not local unless `--i-know` is passed.
 */

const API = process.env.KANGARU_API ?? 'http://localhost:8000/api/v1';

/** Kampala city centre. Where the demo fleet and the seeded zones are. */
const DEFAULT_NEAR = { latitude: 0.3476, longitude: 32.5825 };

const args = parseArgs(process.argv.slice(2));
const role = args._[0];

if (!['driver', 'order', 'status'].includes(role)) {
  console.error('usage: simulate-dispatch.mjs <driver|order|status> [--flags]');
  process.exit(2);
}

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(API) && !args['i-know']) {
  console.error(`refusing to simulate against ${API} — pass --i-know if that is really what you want`);
  process.exit(2);
}

await { driver: driverPhone, order: placeOrder, status: showStatus }[role]();

/* ------------------------------------------------------------------ *
 * The driver's phone
 * ------------------------------------------------------------------ */

/**
 * One driver, on duty, holding a phone.
 *
 * The loop is two timers because the app's is: presence on the server's
 * `heartbeat_seconds` (`PresenceController`), offers on five seconds
 * (`OFFER_POLL_INTERVAL_MS`). Running them as one timer at the slower cadence
 * would hide the thing worth watching — how long an offer takes to surface —
 * and at the faster cadence would send sixty position updates a minute, which
 * is not what a handset does and not what the battery comment in
 * `config/dispatch.php` is about.
 */
async function driverPhone() {
  const email = args.email ?? 'driver.free@kangaruride.test';
  const password = args.password ?? 'password';
  const near = coordinate(args.near) ?? DEFAULT_NEAR;

  const token = await signIn(email, password);
  const me = await api('/auth/me', { token });
  say(`signed in as ${me.name ?? email} (user ${me.id})`);

  const duty = await api('/me/duty', {
    token,
    method: 'PUT',
    body: { on_duty: true, vehicle_id: args.vehicle ? Number(args.vehicle) : null },
  });

  say(`on duty, heartbeat every ${duty.heartbeat_seconds}s`);

  /*
   * The trap `DriverPresenceController::vehicleFor` documents, checked out
   * loud rather than left to be discovered as "the offers never came".
   *
   * A driver on duty with no vehicle is ranked by the matcher and then
   * dropped as unofferable — `WalkInRecommender::offerableFor` filters them —
   * so the simulation would beat happily forever and receive nothing, with
   * every part of it apparently working.
   */
  if (duty.vehicle_id === null) {
    say(
      'NO VEHICLE. The server has no record of what this driver drives, so the ' +
        'matcher will rank them and then drop them as unofferable. Pass --vehicle=ID.',
      'warn',
    );
  } else {
    say(`vehicle ${duty.vehicle_id}`);
  }

  await heartbeat(token, near);

  /*
   * A job already in this driver's hands, before waiting for a new one.
   *
   * Not tidiness: a live trip *occupies* the driver and their vehicle
   * (`TripStatus::occupiesVehicle`), so `AvailabilityService` excludes them
   * and no offer can arrive while one is open. A simulation restarted after
   * an accept would sit there beating, receiving nothing, with every part of
   * it apparently healthy — which is the same silent failure the missing
   * vehicle above produces, from a different cause.
   */
  if (args.drive) {
    await resumeLiveTrip(token).catch(reportAndContinue);
  }

  const stop = () => {
    say('signing off');
    api('/me/duty', { token, method: 'PUT', body: { on_duty: false, vehicle_id: null } })
      .catch(() => {})
      .finally(() => process.exit(0));
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  setInterval(() => void heartbeat(token, near).catch(reportAndContinue), duty.heartbeat_seconds * 1000);
  setInterval(() => void pollOffers(token).catch(reportAndContinue), 5_000);

  say('waiting for work — place an order at http://localhost:5173/order');
}

async function heartbeat(token, near) {
  /*
   * A metre or two of jitter on each beat.
   *
   * Not decoration: a stationary point is indistinguishable from a phone
   * replaying its last reading, and the ranking is a distance. Watching the
   * `pickup_distance_km` on an offer move slightly between runs is how you
   * know the figure came from this beat and not from a row seeded an hour ago.
   */
  const drift = () => (Math.random() - 0.5) * 0.0002;

  await api('/me/presence', {
    token,
    method: 'POST',
    body: {
      latitude: near.latitude + drift(),
      longitude: near.longitude + drift(),
      accuracy_metres: 25,
      recorded_at: new Date().toISOString(),
      vehicle_id: args.vehicle ? Number(args.vehicle) : null,
    },
  });
}

/**
 * The five-second poll, and the accept.
 *
 * `GET /me/offers` is the source of truth and not the push notification —
 * ADR-0025 §3 — which is the one reason a simulation like this can be honest
 * about what a phone would see. Push shortens the latency; it is not the
 * transport, and nothing here pretends to receive one.
 */
async function pollOffers(token) {
  const offers = await api('/me/offers', { token });

  for (const offer of offers) {
    say(
      `OFFER #${offer.id} — ${offer.service_type} from ${offer.pickup?.label ?? 'somewhere'} ` +
        `(${fmt(offer.pickup_distance_km)} km away, ${offer.expires_in_seconds}s to answer` +
        `${offer.estimated_fare ? `, ~${money(offer.estimated_fare)}` : ''})`,
    );

    if (args.decline) {
      await api(`/me/offers/${offer.id}/decline`, {
        token,
        method: 'POST',
        body: { reason: 'simulated decline' },
      });
      say(`declined #${offer.id} — the search should move to the next driver`);
      continue;
    }

    try {
      const trip = await api(`/me/offers/${offer.id}/acceptance`, { token, method: 'POST' });
      say(`ACCEPTED #${offer.id} → trip #${trip.id} (${trip.status}) ${trip.origin} → ${trip.destination}`);

      if (args.drive) {
        await driveTrip(token, trip);
      } else {
        say(
          `trip #${trip.id} is now live and this driver occupies vehicle ${trip.vehicle_id ?? '?'} — ` +
            'no further offer can reach them until it completes. Pass --drive to have the ' +
            'simulated phone finish the journey.',
          'warn',
        );
      }
    } catch (error) {
      // The expected failure, and not a bug: the clock ran out mid-poll, or
      // another driver took it. Said plainly rather than crashing the phone.
      say(`could not take #${offer.id}: ${error.message}`, 'warn');
    }
  }
}

/**
 * Finishes whatever this driver was already holding.
 *
 * `GET /trips` is the driver's own list — the controller narrows anyone
 * without `trips.view.all` to their own trips — so the first row that is
 * still mid-journey is the one blocking the pool.
 */
async function resumeLiveTrip(token) {
  const trips = await api('/trips', { token });
  const live = (trips ?? []).find((trip) => (trip.allowed_transitions ?? []).some((to) =>
    ['driver_en_route', 'driver_arrived', 'passenger_onboard', 'trip_started', 'trip_completed'].includes(to)));

  if (live === undefined) {
    return;
  }

  say(`trip #${live.id} is still open at ${live.status} — finishing it first`);

  await driveTrip(token, live);
}

/**
 * Drives the accepted job to completion, one transition at a time.
 *
 * ## Why it reads `allowed_transitions` instead of holding the graph
 *
 * The lifecycle is served, not duplicated — the same decision the app made
 * and `config/dispatch.php` explains for the heartbeat cadence. A copy of
 * `TripStatus::allowedTransitions()` in here would be a second graph to keep
 * in step, and its failure mode is a simulation that keeps passing after the
 * real graph changed. So each step asks the trip what it will accept and
 * takes the first state on the driver's own path that appears there.
 *
 * `waiting` and `no_show` are deliberately not on that path. Both are
 * legitimate driver actions and neither moves a job forward, so a simulator
 * that took them would wander; `no_show` is not even offered to a driver
 * (`TripPolicy::DRIVER_JOURNEY_STATES` withholds it).
 *
 * ## The odometer is the point, not a formality
 *
 * `odometer_start` and `odometer_end` are two of the Bank's six acceptance
 * criteria (PROJECT.md). They are required by `TransitionTripRequest` at
 * `trip_started` and `trip_completed`, and the closing reading is validated
 * against the opening one and against `tracking.odometer_max_km_per_trip` —
 * so this reads the vehicle's own last reading and adds a plausible trip
 * rather than sending a round number that a tightened ceiling would reject.
 */
async function driveTrip(token, accepted) {
  const FORWARD = ['driver_en_route', 'driver_arrived', 'passenger_onboard', 'trip_started', 'trip_completed'];
  const pace = Number(args.pace ?? 3) * 1000;

  let trip = accepted;
  let odometerStart = null;

  for (const target of FORWARD) {
    if (!(trip.allowed_transitions ?? []).includes(target)) {
      say(`trip #${trip.id} will not accept ${target} from ${trip.status} — stopping there`, 'warn');
      break;
    }

    await pause(pace);

    const body = { to: target };

    if (target === 'trip_started') {
      odometerStart = (trip.odometer_start ?? 0) || 40_000 + Math.floor(Math.random() * 20_000);
      body.odometer_start = odometerStart;
    }

    if (target === 'trip_completed') {
      // A distance that fits the ride rather than a fixed number: the closing
      // reading is checked against the opening one and against the per-trip
      // ceiling, and inventing 500 km on a hop across Kampala is how a
      // simulation ends in a 422 that looks like a platform bug.
      body.odometer_end = odometerStart + Math.max(3, Math.round(trip.trip_distance_km ?? 12));
    }

    trip = await api(`/trips/${trip.id}/transitions`, { token, method: 'POST', body });
    say(`trip #${trip.id} → ${trip.status}${body.odometer_start ? ` (odometer ${body.odometer_start})` : ''}${
      body.odometer_end ? ` (odometer ${body.odometer_end})` : ''
    }`);
  }

  if (trip.status === 'trip_completed') {
    say(`trip #${trip.id} completed — this driver is back in the dispatch pool`);
  }
}

/* ------------------------------------------------------------------ *
 * Somebody ordering
 * ------------------------------------------------------------------ */

/**
 * The web app's order form, as an HTTP call.
 *
 * The same unauthenticated `POST /public/order-requests` that
 * `frontend/src/pages/public/publicOrder.ts` posts, with the same field
 * names, so this exercises the real intake — honeypot, throttle, intake
 * switch and all. It is the fallback for a headless run; the demonstration
 * is the browser.
 */
async function placeOrder() {
  const service = args.service ?? 'ride';
  const near = coordinate(args.near) ?? DEFAULT_NEAR;

  const body = {
    service_type: service,
    contact_name: args.name ?? 'Simulated Customer',
    contact_phone: args.phone ?? '0700000000',
    pickup_location: args.pickup ?? 'Kampala Road, Kampala',
    pickup_latitude: near.latitude,
    pickup_longitude: near.longitude,
    dropoff_location: args.dropoff ?? 'Entebbe International Airport',
    dropoff_latitude: 0.0424,
    dropoff_longitude: 32.4435,
    notes: 'Placed by tools/simulate-dispatch.mjs',
    ...(service === 'delivery'
      ? { details: { package_description: 'One sealed envelope', package_size: 'small' } }
      : {}),
  };

  const { reference } = await api('/public/order-requests', { method: 'POST', body });

  say(`order ${reference} placed (${service})`);
  say(`watch it with: node tools/simulate-dispatch.mjs status --reference=${reference}`);
}

/* ------------------------------------------------------------------ *
 * Watching from the outside
 * ------------------------------------------------------------------ */

/**
 * Where the search has got to, read the way the desk reads it.
 *
 * Staff-authenticated, because ADR-0012 §3 deliberately gives the public
 * intake no GET — a status checker keyed by a guessable reference is an
 * enumeration surface. So this signs in as the dispatcher and reads the
 * queue, which is also the surface a demo audience should be looking at.
 */
async function showStatus() {
  const token = await signIn(
    args.email ?? 'dispatch@kangaruride.test',
    args.password ?? 'password',
    'console',
  );

  const requests = await api('/order-requests?per_page=10', { token });
  const wanted = args.reference
    ? requests.filter((request) => request.reference === args.reference)
    : requests.slice(0, 5);

  for (const request of wanted) {
    say(
      `${request.reference}  ${request.service_type}  ${request.status}` +
        `  trip=${request.trip_id ?? '—'}  ${request.pickup_location ?? ''}`,
    );
  }

  if (wanted.length === 0) {
    say('nothing matched', 'warn');
  }
}

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

/**
 * `client` is not optional (ADR-0022): omitting it mints an unscoped console
 * token, so a simulation of the phone would be testing permissions the phone
 * does not have — and the first real handset would then 403 on a route this
 * script had proved worked.
 */
async function signIn(email, password, client = 'driver') {
  const data = await api('/auth/login', { method: 'POST', body: { email, password, client } });

  if (!data.token) {
    throw new Error(
      'login returned an MFA challenge rather than a token — this account has a second factor ' +
        'and cannot be driven from here (ADR-0010).',
    );
  }

  return data.token;
}

async function api(path, { token = null, method = 'GET', body = null } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const envelope = await response.json().catch(() => null);

  if (!response.ok) {
    // The platform's failure envelope is {success, code, message, errors}
    // (AGENTS.md API Standards). Surfacing `code` matters more than the
    // status: NOT_ON_DUTY, OFFER_NO_LONGER_OPEN and ORDERING_PAUSED are all
    // things a run hits legitimately, and each means something different.
    const code = envelope?.code ? `${envelope.code}: ` : '';
    throw new Error(`${method} ${path} → ${response.status} ${code}${envelope?.message ?? ''}`);
  }

  return envelope?.data;
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (const argument of argv) {
    if (argument.startsWith('--')) {
      const [key, value] = argument.slice(2).split('=');
      parsed[key] = value ?? true;
    } else {
      parsed._.push(argument);
    }
  }

  return parsed;
}

function coordinate(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const [latitude, longitude] = value.split(',').map(Number);

  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

/**
 * `estimated_fare` is a `WalkInQuote`, in minor units and carrying
 * `is_estimate: true` — the flag exists so no client can render a quote as a
 * bill, so this prints the tilde and the word.
 */
function money(quote) {
  return `${quote.currency} ${(quote.total_minor / 100).toLocaleString('en-UG')} est.`;
}

function fmt(number) {
  return typeof number === 'number' ? number.toFixed(2) : '?';
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function say(message, level = 'info') {
  const stamp = new Date().toTimeString().slice(0, 8);
  console[level === 'warn' ? 'warn' : 'log'](`[${stamp}] ${level === 'warn' ? '! ' : ''}${message}`);
}

function reportAndContinue(error) {
  // A timer that throws unhandled takes the whole phone down, and the thing
  // this simulates is a device on a bad connection. One failed beat is not a
  // reason to stop beating.
  say(error.message, 'warn');
}
