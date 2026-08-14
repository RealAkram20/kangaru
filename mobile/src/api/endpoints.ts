import type { ApiClient } from './client';
import type {
  AvailabilityBlock,
  AvailabilityKind,
  Coordinates,
  CursorMeta,
  DispatchOffer,
  DriverPresence,
  Trip,
  TripEvent,
  TripRoute,
  User,
} from './types';

/**
 * Every call this app is allowed to make.
 *
 * Deliberately one file, and deliberately short: ADR-0022 scopes a driver
 * token to nineteen route names, and this module is meant to read as that
 * list. Anything absent here is absent because the token cannot reach it —
 * adding a call is a conversation with the backend, not a new function.
 */

export type LoginResult =
  | { kind: 'authenticated'; user: User; token: string }
  /**
   * MFA is not part of the Driver's Application (PROJECT.md Phase 1 requires
   * it for Super Admin and Finance only), but ADR-0010 made enrolment
   * voluntary, so a driver *can* have a factor. The app cannot complete that
   * exchange and says so plainly rather than crashing on an unexpected 202.
   */
  | { kind: 'mfa_required' };

export async function login(
  api: ApiClient,
  email: string,
  password: string,
): Promise<LoginResult> {
  const response = await api.request<{ user: User; token: string } | { challenge_id: string }>(
    '/auth/login',
    {
      method: 'POST',
      // ADR-0022. Not optional for this app: omitting it mints an unscoped
      // console token, which works and is exactly the wrong thing to leave on
      // a phone that can be lost in a taxi.
      body: { email, password, client: 'driver' },
    },
  );

  if ('token' in response.data) {
    return { kind: 'authenticated', user: response.data.user, token: response.data.token };
  }

  return { kind: 'mfa_required' };
}

export async function fetchMe(api: ApiClient): Promise<User> {
  const response = await api.request<User>('/auth/me');

  return response.data;
}

export async function logout(api: ApiClient): Promise<void> {
  await api.request('/auth/logout', { method: 'POST' });
}

/**
 * Changes the signed-in driver's own password.
 *
 * **This revokes every token the account holds, including the one that made
 * the request.** The caller is signed out by the same call that succeeds, so
 * nothing authenticated may be attempted afterwards — see `PasswordScreen`.
 *
 * Deliberately *not* routed through the offline outbox. Every other mutation
 * this app makes is queued; this one must not be. It re-authenticates with the
 * current password, and a queued credential change would apply at some
 * unpredictable later moment, revoking the token mid-shift for a reason the
 * driver has long forgotten. It needs a connection, and says so.
 */
export async function changePassword(
  api: ApiClient,
  input: { currentPassword: string; newPassword: string },
): Promise<string> {
  const response = await api.request<null>('/auth/password', {
    method: 'PATCH',
    body: {
      current_password: input.currentPassword,
      password: input.newPassword,
      // The server's `confirmed` rule needs this field present. The screen
      // collects it, so a typo locks nobody out of their own account.
      password_confirmation: input.newPassword,
    },
  });

  return response.message;
}

export async function fetchTrips(api: ApiClient, cursor?: string): Promise<{
  trips: Trip[];
  nextCursor: string | null;
}> {
  const response = await api.request<Trip[], CursorMeta>('/trips', { query: { cursor } });

  return { trips: response.data, nextCursor: response.meta?.cursor.next ?? null };
}

export async function fetchTrip(api: ApiClient, tripId: number): Promise<Trip> {
  const response = await api.request<Trip>(`/trips/${tripId}`);

  return response.data;
}

/**
 * The road ahead, from where the driver is (ADR-0031).
 *
 * The key lives on the server and this endpoint is why — a Directions key in
 * this bundle would be extractable, and it bills per request.
 *
 * `from` is optional: without a fix the server routes from the pickup, which
 * is still the right line for a driver who has not moved yet.
 */
export async function fetchTripRoute(
  api: ApiClient,
  tripId: number,
  from: Coordinates | null,
): Promise<TripRoute | null> {
  const query =
    from === null ? '' : `?from_latitude=${from.lat}&from_longitude=${from.lng}`;

  const response = await api.request<{ route: TripRoute | null }>(
    `/trips/${tripId}/route${query}`,
  );

  return response.data.route;
}

export async function fetchTripEvents(api: ApiClient, tripId: number): Promise<TripEvent[]> {
  const response = await api.request<TripEvent[], CursorMeta>(`/trips/${tripId}/events`);

  return response.data;
}

export async function fetchAvailabilityRequests(api: ApiClient): Promise<AvailabilityBlock[]> {
  const response = await api.request<AvailabilityBlock[]>('/me/availability-requests');

  return response.data;
}

/**
 * ADR-0017 §6: this endpoint takes no `resource_id` and no `status`. Both are
 * pinned by the server — to the caller's own driver profile, in the
 * `requested` state — so there is nothing here for the app to get wrong, and
 * nothing for it to send on somebody else's behalf.
 */
export async function createAvailabilityRequest(
  api: ApiClient,
  payload: { kind: AvailabilityKind; starts_at: string; ends_at: string | null; reason: string },
): Promise<AvailabilityBlock> {
  const response = await api.request<AvailabilityBlock>('/me/availability-requests', {
    method: 'POST',
    body: payload,
  });

  return response.data;
}

export async function withdrawAvailabilityRequest(api: ApiClient, id: number): Promise<void> {
  await api.request(`/me/availability-requests/${id}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ *
 * Duty and presence (ADR-0024 §2)
 *
 * The input automatic dispatch was missing. Trip GPS only streams from
 * `trip_started`, so a driver waiting at a stage reported nothing at all and
 * "the nearest driver" was a question with no data behind it.
 * ------------------------------------------------------------------ */

export async function fetchDuty(api: ApiClient): Promise<DriverPresence> {
  const response = await api.request<DriverPresence>('/me/duty');

  return response.data;
}

/**
 * Goes on or off duty.
 *
 * PUT, not POST: there is one duty state per driver to replace, and a driver
 * whose request times out and retries must not start two shifts.
 *
 * Deliberately **not** through the offline outbox, for the same reason the
 * password change is not: a queued "go on duty" would apply at some
 * unpredictable later moment, putting a driver into the dispatch pool hours
 * after they went home. It needs a connection, and the screen says so.
 */
export async function setDuty(
  api: ApiClient,
  input: { onDuty: boolean; vehicleId?: number | null },
): Promise<DriverPresence> {
  const response = await api.request<DriverPresence>('/me/duty', {
    method: 'PUT',
    body: { on_duty: input.onDuty, vehicle_id: input.vehicleId ?? null },
  });

  return response.data;
}

/**
 * Reports where an on-duty driver is.
 *
 * One point, not a batch, and not queued. `POST /trips/{trip}/locations`
 * batches because it is billing evidence and none of it may be lost; this is
 * a dispatch radius, where only the newest point has any use. A driver coming
 * out of a dead zone should send where they are *now* — replaying where they
 * were would rank them from a place they have left.
 *
 * 409 NOT_ON_DUTY when the shift has ended. The caller treats that as the
 * server correcting it, not as an error to retry.
 */
export async function sendPresence(
  api: ApiClient,
  input: {
    latitude: number;
    longitude: number;
    accuracyMetres?: number | null;
    recordedAt: string;
    vehicleId?: number | null;
  },
): Promise<DriverPresence> {
  const response = await api.request<DriverPresence>('/me/presence', {
    method: 'POST',
    body: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy_metres: input.accuracyMetres ?? null,
      recorded_at: input.recordedAt,
      vehicle_id: input.vehicleId ?? null,
    },
  });

  return response.data;
}

/* ------------------------------------------------------------------ *
 * Job offers (ADR-0024 §3)
 *
 * This list is the source of truth, not a push notification. Push shortens
 * the latency; ADR-0025 §3 makes it best-effort, because a driver can refuse
 * the OS permission and ADR-0023's whole thesis is dead zones.
 * ------------------------------------------------------------------ */

export async function fetchOffers(api: ApiClient): Promise<DispatchOffer[]> {
  const response = await api.request<DispatchOffer[]>('/me/offers');

  return response.data;
}

/**
 * Takes the job. Returns the Trip that was created.
 *
 * **Never queued through the outbox**, and this is the sharpest case of that
 * rule in the app. An offer has a fifteen-second clock; a queued accept would
 * be delivered after it expired, to a passenger already collected by somebody
 * else. The server refuses it with 409 OFFER_NO_LONGER_OPEN, which is the
 * right answer — but queueing it would mean the driver's phone told them they
 * had the job for minutes before finding out.
 *
 * So this needs a connection, fails loudly, and the offer simply disappears
 * from the list when its clock runs out.
 */
export async function acceptOffer(api: ApiClient, offerId: number): Promise<Trip> {
  const response = await api.request<Trip>(`/me/offers/${offerId}/acceptance`, { method: 'POST' });

  return response.data;
}

export async function declineOffer(
  api: ApiClient,
  offerId: number,
  reason?: string,
): Promise<void> {
  await api.request(`/me/offers/${offerId}/decline`, {
    method: 'POST',
    body: reason === undefined ? {} : { reason },
  });
}

/* ------------------------------------------------------------------ *
 * Push registration (ADR-0025 §4)
 * ------------------------------------------------------------------ */

/**
 * Registers this install so job offers can reach the lock screen.
 *
 * Idempotent server-side by the token's unique index, so it is safe to call
 * on every sign-in and every OS token rotation. Not queued: a registration
 * that arrives an hour late is a registration for a shift that has ended,
 * and the app polls offers regardless (ADR-0025 §3).
 */
export async function registerDevice(
  api: ApiClient,
  input: { token: string; platform?: string | null; appVersion?: string | null },
): Promise<void> {
  await api.request('/me/devices', {
    method: 'POST',
    body: {
      token: input.token,
      provider: 'expo',
      platform: input.platform ?? null,
      app_version: input.appVersion ?? null,
    },
  });
}

/**
 * Unregisters this install.
 *
 * Called on sign-out, and it matters more than it looks: a shared depot
 * handset that kept its previous driver's token would deliver another
 * person's job offers — pickup address on the lock screen — to whoever is
 * holding the phone next.
 */
export async function unregisterDevice(api: ApiClient, token: string): Promise<void> {
  await api.request(`/me/devices/${encodeURIComponent(token)}`, { method: 'DELETE' });
}

/** The two consent notices, as plain text (ADR-0014, `legal` group). */
export type LegalDocuments = {
  terms: string;
  privacy: string;
};

/**
 * The Terms and Privacy notices shown on the sign-up form.
 *
 * The one call in this file that is not on ADR-0022's allow-list, and does not
 * need to be: `GET /public/legal` carries no auth middleware at all. It could
 * not — a document somebody must agree to *before* they have an account cannot
 * sit behind having one.
 *
 * The office edits both from the settings screen, so the wording reaching a
 * driver is whatever the owner last saved rather than whatever shipped in the
 * binary.
 */
export async function fetchLegalDocuments(api: ApiClient): Promise<LegalDocuments> {
  const response = await api.request<LegalDocuments>('/public/legal');

  return response.data;
}

/**
 * Applies to drive for KangaruRide (ADR-0027).
 *
 * Like `fetchLegalDocuments`, unauthenticated and off ADR-0022's allow-list
 * by nature: this is the one form a person reaches before they are anybody.
 *
 * A 202 means *received*, not *approved* — no account exists until the
 * office reviews the application, which is why nothing is returned and the
 * screen must not attempt a sign-in afterwards. The server deliberately
 * answers the same way whether or not the email is already known.
 */
export async function submitDriverApplication(
  api: ApiClient,
  input: {
    name: string;
    phone: string;
    email: string;
    password: string;
    confirmation: string;
    /** Consent to the /public/legal notices. The server refuses without it. */
    termsAccepted: boolean;
  },
): Promise<void> {
  await api.request('/driver-applications', {
    method: 'POST',
    body: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      password: input.password,
      password_confirmation: input.confirmation,
      terms_accepted: input.termsAccepted,
    },
  });
}

/** Which ways in the owner has switched on (ADR-0028 §1). */
export type AuthMethods = {
  password_reset_enabled: boolean;
  google_enabled: boolean;
  facebook_enabled: boolean;
  /** Public identifiers the native flows start with — never secrets. */
  google_client_ids: string | null;
  facebook_app_id: string | null;
};

/**
 * The welcome screen's shape, from the server's mouth.
 *
 * Fail-closed by construction: a phone that cannot fetch this renders no
 * social buttons and no reset link, because a method the owner may have
 * turned off must not be resurrected by a stale client. The query layer
 * caches it like everything else, so "this morning's answer" is the worst
 * case, not "none".
 */
export async function fetchAuthMethods(api: ApiClient): Promise<AuthMethods> {
  const response = await api.request<{ settings: { auth: AuthMethods } }>('/public/settings');

  return response.data.settings.auth;
}

/**
 * Asks for an emailed reset code (ADR-0028 §2).
 *
 * A 202 deliberately says nothing about whether the address exists — the
 * screen's copy must not pretend otherwise.
 */
export async function forgotPassword(api: ApiClient, email: string): Promise<void> {
  await api.request('/auth/password/forgot', { method: 'POST', body: { email } });
}

/** Exchanges the emailed code for a new password. Revokes every session. */
export async function resetPassword(
  api: ApiClient,
  input: { email: string; code: string; password: string; confirmation: string },
): Promise<void> {
  await api.request('/auth/password/reset', {
    method: 'POST',
    body: {
      email: input.email,
      code: input.code,
      password: input.password,
      password_confirmation: input.confirmation,
    },
  });
}

export type SocialSignInResult =
  | { status: 'signed_in'; user: User; token: string }
  /** No account: take the verified fields to the application form (ADR-0027). */
  | { status: 'sign_up'; name: string; email: string };

/**
 * Hands the provider's proof to the server (ADR-0028 §3), which verifies it
 * against the admin-stored credentials and answers who this identity is
 * here. Refusals arrive as ApiError with stable codes: AUTH_METHOD_DISABLED,
 * SOCIAL_TOKEN_INVALID, MFA_REQUIRED, NOT_A_DRIVER.
 */
export async function socialSignIn(
  api: ApiClient,
  input: { provider: 'google' | 'facebook'; token: string },
): Promise<SocialSignInResult> {
  const response = await api.request<SocialSignInResult>('/auth/social', {
    method: 'POST',
    body: { provider: input.provider, token: input.token, client: 'driver' },
  });

  return response.data;
}

/**
 * The driver's own numbers, counted server-side from trips, offers, the
 * ledger (ADR-0029) and their ratings (ADR-0030).
 *
 * **This type drifted from the contract once and nothing caught it**, which is
 * worth a line here because it will happen again. `fares_today_minor` and
 * `fares_currency` were renamed server-side to `earnings_today_minor` and
 * `currency`; this file kept the old names, so `stats.fares_today_minor` was
 * `undefined` at runtime and the home screen rendered `undefined NaN` where a
 * driver's money goes. TypeScript cannot help — every type in this file is
 * *hand-transcribed* from `docs/api/openapi.yaml`, which is the authority.
 * When a payload changes, this is the second place to edit.
 */
export type DriverStats = {
  trips_today: number;
  /**
   * The driver's **own share** of today's fares, from the ledger (ADR-0029
   * §5) — not the gross figure the passenger paid. Minor units; UGX is
   * zero-decimal, so these are whole shillings and must not be divided.
   */
  earnings_today_minor: number;
  /**
   * The whole ledger summed. **Negative is legitimate** and means the driver
   * is holding the platform's cash until they settle — the honest reading,
   * and the one a settlement conversation starts from.
   */
  wallet_balance_minor: number;
  currency: string;
  /** 0–100, or null until there is something to divide by. */
  acceptance_rate: number | null;
  completion_rate: number | null;
  /**
   * Mean of the last 50 ratings, one decimal — **null until five exist**
   * (ADR-0030 §3). One three-star rating is not a 3.0; it is one person's
   * afternoon, and publishing it as a score invites a driver to read a single
   * bad interaction as a permanent standing.
   */
  rating: number | null;
  /** How many ratings the score rests on. Served even while the score is withheld. */
  rating_count: number;
  window_days: number;
};

/** The span the earnings screen is showing. No `year` — see the server enum. */
export type EarningsPeriod = 'day' | 'week' | 'month';

/**
 * Earnings grouped by the kind of job that produced them.
 *
 * `service_type` is `ride`, `delivery` or `self_drive` from the order request
 * behind the trip — or **`other`**, meaning the trip has no order request and
 * cannot be classified (a walk-in a dispatcher fulfilled by hand). It is a
 * row rather than an omission so the breakdown always reconciles with the
 * total above it.
 *
 * Deliberately a plain `string`, not a union. The server sends whatever
 * `order_requests.service_type` holds, and that column is a `string(20)` fed
 * partly by a public form — a union here would be a lie the compiler enforces.
 * `serviceLabel` in `earnings/presentation.ts` is the one place that narrows
 * it, and anything unrecognised renders as itself rather than as a crash.
 */
export type EarningsBreakdownRow = {
  service_type: string;
  trips: number;
  earned_minor: number;
};

/**
 * One bar of the trend chart.
 *
 * **The series is continuous and zero-filled** — every bucket between `from`
 * and `to` is present, empty ones included. An hour with no entry is not
 * unknown: the ledger is written at completion, so nothing completed in it and
 * the driver earned exactly nothing. Dropping empty buckets would compress the
 * axis and draw 3 AM beside 7 PM.
 */
export type EarningsTrendPoint = {
  /** Local-time key, sorting chronologically: `YYYY-MM-DD HH:00` or `YYYY-MM-DD`. */
  bucket: string;
  earned_minor: number;
};

/**
 * What a driver earned over a day, a week or a month.
 *
 * Hand-transcribed from `docs/api/openapi.yaml` like everything else in this
 * file — see `DriverStats` above for the drift that cost a live bug.
 *
 * **There is no `tips_minor`, no `bonuses_minor` and no online-hours figure,
 * and their absence is deliberate rather than pending.** None of the three
 * exists anywhere on this platform. `on_trip_minutes` is time *driving*, which
 * is a different and smaller thing than time online — the platform keeps no
 * duty history to measure the latter from.
 */
export type DriverEarnings = {
  period: EarningsPeriod;
  /**
   * The zone the boundaries and bucket keys are in, from the platform's
   * regional settings. Served rather than assumed, so the chart is labelled in
   * the fleet's day rather than the handset's — a driver near a border must
   * not see their day move.
   */
  timezone: string;
  from: string;
  /** **Exclusive.** The window is half-open `[from, to)`. */
  to: string;
  currency: string;
  /** The driver's own share, in minor units. Never the gross fare. */
  total_minor: number;
  trips: number;
  /**
   * Minutes spent on trips, or null when no trip in the window carries both
   * timestamps. **Not online hours** — see the type docblock.
   */
  on_trip_minutes: number | null;
  breakdown: EarningsBreakdownRow[];
  trend: EarningsTrendPoint[];
};

export async function fetchDriverEarnings(
  api: ApiClient,
  period: EarningsPeriod,
): Promise<DriverEarnings> {
  const response = await api.request<DriverEarnings>(`/me/earnings?period=${period}`);

  return response.data;
}

/**
 * One movement in a driver's account (ADR-0029 §2) — a row of the wallet
 * statement.
 *
 * Hand-transcribed from `docs/api/openapi.yaml`, like everything else here.
 *
 * **There is no tip, bonus, withdrawal or top-up kind, and there never was.**
 * The four kinds below are the whole vocabulary. A screen showing any of the
 * other four would be inventing a transaction type.
 */
export type DriverLedgerEntry = {
  id: number;
  kind: 'fare_earned' | 'cash_collected' | 'settlement' | 'adjustment';
  /** The kind in words, from the server's own enum, so nothing re-spells them. */
  kind_label: string;
  /**
   * **Signed, and the sign is the meaning**: positive means the platform owes
   * the driver, negative means the driver owes the platform. Minor units —
   * UGX is zero-decimal, so whole shillings, and never divide.
   *
   * Direction must not be inferred from `kind`: `settlement` legitimately
   * runs both ways, which is why ADR-0029 §2 replaced a one-way `payout`.
   */
  amount_minor: number;
  currency: string;
  /**
   * Server-written prose, and load-bearing rather than decorative: ADR-0029
   * §3 records the commission rate in force *at completion* in this string,
   * which is what lets an old row show the rate that actually applied to it.
   */
  description: string;
  trip_id: number | null;
  /**
   * `ride`, `delivery` or `self_drive` — so a row can read "Ride earnings"
   * rather than the generic "Fare earned". Null on a settlement, and on a
   * walk-in a dispatcher fulfilled by hand; the app falls back to
   * `kind_label`, which is always true.
   */
  service_type: string | null;
  created_at: string | null;
};

/** A page of the statement, with the cursor for the next one. */
export type DriverLedgerPage = {
  entries: DriverLedgerEntry[];
  /** Opaque; null on the last page. */
  nextCursor: string | null;
};

export async function fetchDriverLedger(
  api: ApiClient,
  cursor: string | null,
): Promise<DriverLedgerPage> {
  // `CursorMeta` and the `query` option, same as `fetchTrips` — one cursor
  // shape and one place that spells it, rather than a second hand-built URL.
  const response = await api.request<DriverLedgerEntry[], CursorMeta>('/me/ledger-entries', {
    query: { cursor: cursor ?? undefined },
  });

  // `meta` is optional on the envelope, so this cannot assume it arrived.
  return { entries: response.data, nextCursor: response.meta?.cursor.next ?? null };
}

export async function fetchDriverStats(api: ApiClient): Promise<DriverStats> {
  const response = await api.request<DriverStats>('/me/stats');

  return response.data;
}
