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
  TripStatus,
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
  kind:
    | 'fare_earned'
    | 'cash_collected'
    | 'settlement'
    | 'adjustment'
    /**
     * The tip pair and the weekly bonus (ADR-0034).
     *
     * `tip_earned` is the driver's share **after commission** — the owner
     * ruled that the platform takes its usual cut of a tip, which is what
     * lets a tip reuse the pair a cash fare writes. `tip_cash_collected` is
     * the gross in their hand, and the net of the two is the commission now
     * owed.
     *
     * `bonus` is **unpaired**: it is not cash in anybody's hand, so the
     * balance moves by the whole amount.
     */
    | 'tip_earned'
    | 'tip_cash_collected'
    | 'bonus';
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

/**
 * A date window over the statement, as whole local days.
 *
 * `YYYY-MM-DD`, and **both ends inclusive** — a driver picking "15 August"
 * for both means the whole of that day. The server measures them in the
 * fleet's timezone, not the handset's, so a driver near a border does not see
 * their day move.
 */
export type LedgerRange = { from?: string; to?: string };

export async function fetchDriverLedger(
  api: ApiClient,
  cursor: string | null,
  range: LedgerRange = {},
): Promise<DriverLedgerPage> {
  // `CursorMeta` and the `query` option, same as `fetchTrips` — one cursor
  // shape and one place that spells it, rather than a second hand-built URL.
  const response = await api.request<DriverLedgerEntry[], CursorMeta>('/me/ledger-entries', {
    query: { cursor: cursor ?? undefined, from: range.from, to: range.to },
  });

  // `meta` is optional on the envelope, so this cannot assume it arrived.
  return { entries: response.data, nextCursor: response.meta?.cursor.next ?? null };
}

/**
 * A driver asking the office to settle (ADR-0032).
 *
 * **This is not a payment and moves no money.** Cash changes hands at the
 * depot exactly as it always has; a request records that the driver says it
 * did, or would like it to, and the ledger only learns about it when somebody
 * at the office confirms.
 *
 * **A pending request never affects the wallet balance.** That figure comes
 * from the ledger alone — if a request moved it, a driver could request their
 * way out of what they owe.
 */
/**
 * `tip` is the third and is not a settlement at all (ADR-0034 §1): it declares
 * that a passenger handed the driver cash on a particular trip. It reuses this
 * pipeline because the mechanism is identical — a driver says money changed
 * hands, and the office's answer is what writes the ledger — and it is the
 * only kind that carries a `trip_id`.
 */
export type SettlementRequestKind = 'remittance' | 'payout' | 'tip';
export type SettlementRequestStatus = 'pending' | 'confirmed' | 'declined';

export type DriverSettlementRequest = {
  id: number;
  driver_id: number;
  /**
   * The trip a tip was taken on. Null on the other two kinds — a remittance
   * covers a day's takings and a payout is a request against a balance, so
   * neither belongs to one journey.
   */
  trip_id: number | null;
  kind: SettlementRequestKind;
  kind_label: string;
  status: SettlementRequestStatus;
  status_label: string;
  /** **Always positive.** The direction is `kind`; only the ledger entry is signed. */
  amount_minor: number;
  currency: string;
  note: string | null;
  /** Present only on a decline, and never empty when it is. */
  decline_reason: string | null;
  reviewed_at: string | null;
  /** The ledger entry a confirmation produced, or null. */
  ledger_entry_id: number | null;
  created_at: string | null;
};

export async function fetchSettlementRequests(
  api: ApiClient,
): Promise<DriverSettlementRequest[]> {
  const response = await api.request<DriverSettlementRequest[]>('/me/settlement-requests');

  return response.data;
}

export async function createSettlementRequest(
  api: ApiClient,
  input: {
    kind: SettlementRequestKind;
    amountMinor: number;
    note: string | null;
    /**
     * Required for `tip` and **refused for the other two kinds** — the server
     * validates both halves. It also checks the trip is this driver's own: a
     * confirmed tip writes a credit, so a declaration against somebody else's
     * job would be a driver inserting themselves into it for money.
     */
    tripId?: number;
  },
): Promise<DriverSettlementRequest> {
  const response = await api.request<DriverSettlementRequest>('/me/settlement-requests', {
    method: 'POST',
    body: {
      kind: input.kind,
      amount_minor: input.amountMinor,
      note: input.note,
      // Omitted rather than sent as null: the server *prohibits* the field on
      // a remittance or a payout, so a null would be a 422 rather than a
      // no-op.
      ...(input.tripId === undefined ? {} : { trip_id: input.tripId }),
    },
  });

  return response.data;
}

/**
 * One row of the driver's own trip history (`GET /me/trips`).
 *
 * Hand-transcribed from `docs/api/openapi.yaml`, like everything else in this
 * file — see `DriverStats` above for the drift that cost a live bug.
 *
 * **Deliberately narrower than `Trip`.** It carries no passenger contact
 * (ADR-0024 §7 releases a name and number only while a trip is *live*; a
 * scrollable history of everyone a driver has carried is the directory that
 * rule exists to prevent) and no fare quote (quoting costs Billing queries per
 * row).
 */
export type DriverHistoryTrip = {
  id: number;
  /**
   * The raw lifecycle value. `statusLabel()` in `trips/transitions.ts` is the
   * one place a status is put into words for a driver — the server
   * deliberately does not send a second wording.
   */
  status: TripStatus;
  /**
   * `ride`, `delivery` or `self_drive`. Null when the trip has no order
   * request behind it — a walk-in a dispatcher fulfilled by hand — and the row
   * then reads as a plain trip rather than as a guess.
   *
   * A plain `string`, not a union, for the reason `EarningsBreakdownRow`
   * gives: the column is a `string(20)` fed partly by a public form.
   */
  service_type: string | null;
  origin: string;
  destination: string;
  /** `completed_at` where there is one, `created_at` otherwise. Never `updated_at`. */
  happened_at: string;
  /**
   * The day this row files under, `YYYY-MM-DD`, **already resolved in the
   * fleet's timezone**. Compare it against `meta.today` / `meta.yesterday`
   * rather than computing a day here: the handset's zone is not necessarily
   * the fleet's, and Hermes' `Intl` data varies by build.
   */
  local_day: string;
  /** `HH:MM`, 24-hour, in the same zone. `timeLabel()` renders it for display. */
  local_time: string;
  /**
   * **What the driver earned, not what the passenger paid.** Read back from
   * the `fare_earned` ledger entry written at completion (ADR-0029 §3), so
   * this list adds up to exactly what the Earnings screen reports.
   *
   * **Null, never zero**, on a cancelled or no-show trip, on a corporate trip
   * (invoiced to the client, so there is no per-trip driver share), and in the
   * window between completion and the ledger listener running. A `0` here
   * would read as a job done for nothing.
   */
  earned_minor: number | null;
  currency: string | null;
};

/** A page of the history, with the day keys its sections are labelled from. */
export type DriverTripHistoryPage = {
  trips: DriverHistoryTrip[];
  /** Opaque; null on the last page. */
  nextCursor: string | null;
  /**
   * The fleet's day, from the server. Absent only if `meta` did not arrive,
   * in which case the screen heads its sections with dates rather than
   * guessing which one is "Today" — a wrong "Today" is worse than a date.
   */
  today: string | null;
  yesterday: string | null;
  timezone: string | null;
};

export async function fetchDriverTripHistory(
  api: ApiClient,
  cursor: string | null,
  serviceType: string | null,
): Promise<DriverTripHistoryPage> {
  const response = await api.request<DriverHistoryTrip[], DriverTripHistoryMeta>('/me/trips', {
    // `CursorMeta`'s sibling and the shared `query` option, as
    // `fetchDriverLedger` uses — one cursor convention, spelled once.
    query: { cursor: cursor ?? undefined, service_type: serviceType ?? undefined },
  });

  // `meta` is optional on the envelope, so none of this may assume it arrived.
  return {
    trips: response.data,
    nextCursor: response.meta?.cursor.next ?? null,
    today: response.meta?.today ?? null,
    yesterday: response.meta?.yesterday ?? null,
    timezone: response.meta?.timezone ?? null,
  };
}

type DriverTripHistoryMeta = {
  cursor: { next: string | null };
  timezone: string;
  today: string;
  yesterday: string;
};

export async function fetchDriverStats(api: ApiClient): Promise<DriverStats> {
  const response = await api.request<DriverStats>('/me/stats');

  return response.data;
}

/**
 * The facts on the driver's own profile screen (ADR-0033).
 *
 * **The rating is deliberately not here**, though the screen shows one:
 * `/me/stats` produces it under ADR-0030's withholding rule, and a second
 * reading of a figure suppressed below five ratings is a second chance to
 * publish it by mistake. The screen reads both and puts them side by side.
 *
 * Hand-transcribed from `openapi.yaml` like every other type in this file —
 * see `DriverStats` above for the drift that cost a live bug.
 */
export type DriverProfile = {
  name: string;
  /**
   * The driver's **profile** phone, not the account's. A driver signs in with
   * an email (ADR-0016) and is reached on this number.
   */
  phone: string | null;
  email: string | null;
  /** A date (`YYYY-MM-DD`), because the screen renders a month and a year. */
  member_since: string | null;
  /**
   * Completed trips, ever. A cancellation is not a trip a driver did — the
   * figure sits beside a rating and must not read flatter than their work.
   */
  trips_total: number;
  /**
   * **Null for a driver with no vehicle of their own**, which is not an edge
   * case: a corporate driver takes whatever the depot hands them that morning.
   * `make` and `model` are individually nullable too — a plate typed in a
   * hurry with no make is a real row.
   */
  vehicle: {
    make: string | null;
    model: string | null;
    registration_number: string;
    category: string;
    category_label: string;
  } | null;
  documents: DriverDocumentCompliance;
};

/** The four papers this platform asks a driver for (ADR-0033 §1). */
export type DriverDocumentType =
  | 'driving_licence'
  | 'identity_document'
  | 'vehicle_insurance'
  | 'vehicle_registration';

/** The three **stored** states. `expired` is not one — see `compliance_state`. */
export type DriverDocumentStatus = 'pending' | 'verified' | 'rejected';

/**
 * The state to act on: the stored status, plus the derived `expired`.
 *
 * **Expiry outranks verification.** A verified licence that lapsed last month
 * reports `expired`, and the app must render that rather than `status` — which
 * still says `verified`, because nothing wrote to the row.
 */
export type DriverDocumentComplianceState = DriverDocumentStatus | 'expired';

export type DriverDocument = {
  id: number;
  driver_id: number;
  type: DriverDocumentType;
  type_label: string;
  status: DriverDocumentStatus;
  status_label: string;
  compliance_state: DriverDocumentComplianceState;
  /** A date, not an instant — a licence expires on a day. */
  expires_at: string | null;
  /** Derived server-side in the operator's timezone. Never computed here. */
  expired: boolean;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
  /** A route path the app may fetch. Never assembled here — see the schema. */
  file_url: string;
};

/**
 * One document type and whatever is held against it.
 *
 * **`document` is null for a type never uploaded, and that is the point.** A
 * driver opening the screen is asking what they still owe the office; the
 * uploaded subset answers a different question.
 */
export type DriverDocumentSlot = {
  type: DriverDocumentType;
  type_label: string;
  /** What to photograph, in the driver's words rather than the schema's. */
  hint: string;
  /** Served rather than hardcoded here, so the rule lives in one place. */
  requires_expiry: boolean;
  document: DriverDocument | null;
};

/**
 * The one-line answer beside "Documents" on the profile screen.
 *
 * `action_needed` covers rejected and expired but **not** never-uploaded,
 * which is `incomplete`. One means "we looked and it is wrong", the other
 * means "we are still waiting" — collapsing them makes a new driver look like
 * a problem.
 */
export type DriverDocumentCompliance = {
  state: 'verified' | 'pending' | 'incomplete' | 'action_needed';
  verified: number;
  total: number;
  action_needed: number;
  pending: number;
};

export async function fetchDriverProfile(api: ApiClient): Promise<DriverProfile> {
  const response = await api.request<DriverProfile>('/me/profile');

  return response.data;
}

export async function fetchDriverDocuments(api: ApiClient): Promise<{
  slots: DriverDocumentSlot[];
  compliance: DriverDocumentCompliance | null;
}> {
  const response = await api.request<DriverDocumentSlot[], { compliance: DriverDocumentCompliance }>(
    '/me/documents',
  );

  // `meta` is optional on the envelope, so this may not assume it arrived.
  return { slots: response.data, compliance: response.meta?.compliance ?? null };
}

/**
 * Sends a document to the office.
 *
 * **Deliberately not routed through the offline outbox**, unlike every other
 * mutation this app makes. ADR-0023 queues small JSON transitions; an
 * eight-megabyte photograph in an AsyncStorage-backed queue is a different
 * problem, and one that would sit there invisibly for hours. This needs a
 * connection, and the screen says so — the same exception `changePassword`
 * already is.
 */
export async function uploadDriverDocument(
  api: ApiClient,
  input: { type: DriverDocumentType; uri: string; expiresAt: string | null },
): Promise<DriverDocument> {
  const form = new FormData();

  form.append('type', input.type);

  if (input.expiresAt !== null) {
    form.append('expires_at', input.expiresAt);
  }

  // React Native's FormData takes a file descriptor object rather than a Blob.
  // The cast is the documented way to express that to TypeScript, whose
  // FormData types describe the browser's — same as `httpTransport` does for
  // the odometer photo.
  form.append('file', {
    uri: input.uri,
    name: documentFileName(input.uri),
    type: documentMimeType(input.uri),
  } as unknown as Blob);

  const response = await api.request<DriverDocument>('/me/documents', {
    method: 'POST',
    form,
    // Longer than the client's 15-second default. This is a single
    // photograph going up over a Ugandan mobile connection with a person
    // watching, and unlike a queued transition there is nothing behind it to
    // retry on their behalf.
    timeoutMs: 60_000,
  });

  return response.data;
}

/**
 * Exported for a test, as `buildTransitionForm` is: React Native's `FormData`
 * polyfill does not hand a file part back intact, so the only way to assert
 * what a document is *labelled* as is to ask these directly.
 */
export function documentFileName(uri: string): string {
  const last = uri.split('/').pop();

  return last === undefined || last === '' ? 'document.jpg' : last;
}

/**
 * The server accepts jpg, jpeg, png, webp and pdf. An iPhone hands back
 * `.heic` from the library, which `expo-image-picker` transcodes to jpeg —
 * so anything unrecognised is labelled jpeg, exactly as `httpTransport` does.
 */
export function documentMimeType(uri: string): string {
  const extension = uri.split('.').pop()?.toLowerCase();

  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'pdf') return 'application/pdf';

  return 'image/jpeg';
}
