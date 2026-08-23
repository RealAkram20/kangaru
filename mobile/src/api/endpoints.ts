import { DUTY_REQUEST_TIMEOUT_MS } from '../config';
import type { ApiClient } from './client';
import { formFile } from './formFile';
import type {
  AvailabilityBlock,
  AvailabilityKind,
  Coordinates,
  CursorMeta,
  DispatchOffer,
  DriverLedgerEntry,
  DriverPresence,
  PlaceSuggestion,
  Trip,
  TripEvent,
  TripRoute,
  TripStatus,
  TripStop,
  TripStopCandidate,
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

export async function login(api: ApiClient, email: string, password: string): Promise<LoginResult> {
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

export async function fetchTrips(
  api: ApiClient,
  cursor?: string,
): Promise<{
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
 *
 * `to` picks the leg. `dropoff` is the fare and the default; `pickup` is the
 * approach, the road between accepting and arriving — which is a route *from*
 * the driver, so without a fix the server answers null rather than a dot.
 */
export async function fetchTripRoute(
  api: ApiClient,
  tripId: number,
  from: Coordinates | null,
  to: 'pickup' | 'dropoff' = 'dropoff',
): Promise<TripRoute | null> {
  const response = await api.request<{ route: TripRoute | null }>(`/trips/${tripId}/route`, {
    query: {
      from_latitude: from?.lat,
      from_longitude: from?.lng,
      // Only said when it differs from the default, so the cached answer
      // for a plain drop-off request keeps its URL.
      to: to === 'dropoff' ? undefined : to,
    },
  });

  return response.data.route;
}

export async function fetchTripEvents(api: ApiClient, tripId: number): Promise<TripEvent[]> {
  const response = await api.request<TripEvent[], CursorMeta>(`/trips/${tripId}/events`);

  return response.data;
}

/**
 * Extends a live run with the next drop-off (ADR-0045 §4).
 *
 * Two shapes, matching the server's: a saved-place pick sends the id alone —
 * the label and pin are copied from the client's register server-side, so
 * this handset cannot mislabel an ATM — or free text sends a label, with
 * coordinates only if something trustworthy produced them.
 *
 * **A direct POST, not an outbox item, deliberately.** The search that feeds
 * it needs connectivity anyway, so a dead zone closes the whole flow rather
 * than half of it: nothing typed is lost because nothing gets typed. The
 * arrive/continue taps — the billable, evidence-bearing acts — stay queued
 * (ADR-0023); this is the one stop action that is not one.
 */
export async function addTripStop(
  api: ApiClient,
  tripId: number,
  input:
    | { clientPlaceId: number }
    | { label: string; latitude?: number; longitude?: number },
): Promise<TripStop> {
  const response = await api.request<TripStop>(`/trips/${tripId}/stops`, {
    method: 'POST',
    body:
      'clientPlaceId' in input
        ? { client_place_id: input.clientPlaceId }
        : {
            label: input.label,
            // Both or neither — `StoreTripStopRequest` refuses half a
            // position, and a geocoder suggestion always carries both.
            ...(input.latitude !== undefined && input.longitude !== undefined
              ? { latitude: input.latitude, longitude: input.longitude }
              : {}),
          },
  });

  return response.data;
}

/**
 * The add-a-drop-off search over the client's own place register (ADR-0045
 * §10) — the ATM estate, served to this trip's driver while the run is live
 * and to nobody else. A walk-in trip answers an empty list, which the screen
 * covers with its free-text row.
 */
export async function fetchTripStopCandidates(
  api: ApiClient,
  tripId: number,
  query: string,
): Promise<TripStopCandidate[]> {
  const response = await api.request<TripStopCandidate[]>(`/trips/${tripId}/stop-candidates`, {
    query: { q: query === '' ? undefined : query },
  });

  return response.data;
}

/**
 * Geocoder suggestions for a stop the register does not know (§10 follow-up,
 * owner decision 2026-08-22). The server proxies a public geocoder and fails
 * soft to an empty list; the free-text row is the floor either way. `q` is
 * required at three characters — the server 422s below that, so callers gate
 * before asking.
 */
export async function fetchPlaceSuggestions(
  api: ApiClient,
  tripId: number,
  query: string,
): Promise<PlaceSuggestion[]> {
  const response = await api.request<PlaceSuggestion[]>(`/trips/${tripId}/place-suggestions`, {
    query: { q: query },
  });

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
    timeoutMs: DUTY_REQUEST_TIMEOUT_MS,
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
 *
 * **Both duty writes carry `DUTY_REQUEST_TIMEOUT_MS` rather than the client's
 * default fifteen seconds.** `config.ts` wrote that constant and argued for
 * it — these are statements about *now*, and a presence ping that lands after
 * thirty seconds of retrying describes somewhere the driver no longer is —
 * but nothing ever passed it, so both ran on the default. It matters most on
 * the path that has no screen: `PresenceTask` runs while the phone is asleep,
 * where a request left hanging holds the wake lock the OS granted for a fix
 * that has already gone stale.
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
    timeoutMs: DUTY_REQUEST_TIMEOUT_MS,
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
  /**
   * Office-authored safety guidance (ADR-0040).
   *
   * **Not a consent document** — nobody agrees to it, and `LegalSheet` must
   * not offer it beside the two that are. It travels with them because it is
   * the same kind of thing: office-authored prose, editable without a deploy,
   * and fetched only when somebody opens the screen that shows it.
   */
  safety: string;
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
 * office reviews the application, which is why the screen must not attempt a
 * sign-in afterwards. The server deliberately answers the same way whether or
 * not the email is already known.
 *
 * **What it does return is a claim ticket, not a session** (ADR-0048 §4).
 * `upload_token` resolves to this one application row and authorises exactly
 * three verbs on exactly one sub-resource: send a document, list what has been
 * sent, withdraw one. It reaches no policy, no trip and no account, it cannot
 * read a file back, and it dies the moment the office decides.
 *
 * **It is returned exactly once and there is no way to ask for it again** —
 * an endpoint that re-issued it would take an email address and say whether an
 * application existed for it, which is the enumeration oracle ADR-0027 §5
 * refuses. Lose it and the applicant sends their papers after approval, from
 * the profile screen, like every other driver.
 */
export type DriverApplicationReceipt = {
  upload_token: string;
  /** ISO 8601. Twenty-four hours out, on the server's clock. */
  upload_expires_at: string | null;
};

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
): Promise<DriverApplicationReceipt> {
  const response = await api.request<DriverApplicationReceipt>('/driver-applications', {
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

  return response.data;
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
 * Whether the office wants odometer readings at all (ADR-0047).
 *
 * The same `/public/settings` document `fetchAuthMethods` reads, for the one
 * key that changes the shape of the trip flow: with the odometer off, Start
 * Trip and Complete Trip become single taps and the reading forms leave the
 * app entirely.
 *
 * **Fails to `true`, which is the opposite of `fetchAuthMethods`'s
 * fail-closed rule and is deliberate.** There, an unreachable server must not
 * resurrect a sign-in method the owner switched off — the safe answer is
 * "off". Here the two failure directions are not symmetrical:
 *
 * - Wrongly *off*: the driver is never asked for a reading, the server (which
 *   has the real setting) then refuses the transition with a 422 for a
 *   missing `odometer_start`, and through the offline outbox that refusal
 *   surfaces on the sync queue long after they left the vehicle. The trip is
 *   stuck and the dashboard is gone.
 * - Wrongly *on*: the driver is asked for a reading nobody needed. The server
 *   accepts it anyway — `TransitionTripRequest` still stores a reading it no
 *   longer demands — so the trip completes normally and the cost is one
 *   screen and a few seconds.
 *
 * One of those strands a trip in the field; the other wastes a tap. The
 * default follows the cheaper mistake.
 */
export async function fetchOdometerEnabled(api: ApiClient): Promise<boolean> {
  const response = await api.request<{
    settings: { tracking?: { odometer_enabled?: boolean } };
  }>('/public/settings');

  // Explicit `=== false`, not truthiness: a deployment whose server predates
  // this key sends no `tracking` group at all, and that must read as "keep
  // asking" rather than as "off".
  return response.data.settings.tracking?.odometer_enabled !== false;
}

/**
 * How to reach the office, from `settings.branding`.
 *
 * **Both are nullable and neither is invented.** `contact_phone` defaults to
 * an empty string in the catalogue, so a deployment that has not set one has
 * no number — and a Support screen that printed a plausible placeholder would
 * send a driver with a real problem to a dead line. The screen renders what is
 * there and says plainly when something is not.
 */
export type OfficeContact = {
  name: string;
  email: string | null;
  phone: string | null;
  /**
   * The emergency services number, from `settings.safety` (ADR-0040).
   *
   * **Never hardcoded and never defaulted.** 999 is Uganda's; this product is
   * built to run elsewhere, and a plausible default is a driver dialling a
   * number that does not answer in their country. Null means the office has
   * published none, and the Safety screen says so rather than guessing.
   */
  emergency: string | null;
};

/**
 * The same `/public/settings` document `fetchAuthMethods` reads, for the half
 * the Support and Safety screens need.
 *
 * A second fetcher over one endpoint rather than a fatter `AuthMethods`: that
 * type is the welcome screen's shape and is read on every cold start, and the
 * two answer different questions. They share a cache key at the query layer,
 * so the second read costs nothing.
 */
export async function fetchOfficeContact(api: ApiClient): Promise<OfficeContact> {
  const response = await api.request<{
    settings: {
      branding?: {
        app_name?: string;
        contact_email?: string | null;
        contact_phone?: string | null;
      };
      safety?: { emergency_number?: string | null };
    };
  }>('/public/settings');

  const branding = response.data.settings.branding;

  // Empty strings are normalised to null here rather than at four call sites.
  // The catalogue's default for `contact_phone` is `''`, and `'' || null` is
  // the difference between a screen saying "call the office" over a blank and
  // saying the office has published no number.
  const clean = (value: string | null | undefined): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

  return {
    name: clean(branding?.app_name) ?? 'the office',
    email: clean(branding?.contact_email),
    phone: clean(branding?.contact_phone),
    emergency: clean(response.data.settings.safety?.emergency_number),
  };
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
 * **Declared in `./types` and re-exported here**, which is a move rather than
 * a change: `TripEarnings.lines` needed it, `types.ts` is where the contract's
 * types live, and a type file importing from the *calls* file points the
 * dependency arrow backwards. Every existing importer reads it from here and
 * keeps working.
 */
export type { DriverLedgerEntry } from './types';

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

export async function fetchSettlementRequests(api: ApiClient): Promise<DriverSettlementRequest[]> {
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

/**
 * Progress towards the weekly trip bonus, in the week **now running**
 * (ADR-0034 §4, ADR-0036 §1).
 *
 * **Nothing here has been earned.** The bonus is awarded by a scheduled
 * command over a *closed* week, so a driver at 18 of 30 is being shown where
 * they are, not what they are owed. `endsAt` is when the week closes and the
 * question gets answered — the screen's wording has to carry that.
 */
export type WeeklyChallenge = {
  /** Completed trips this week, counted by the same rule that pays out. */
  trips: number;
  tripTarget: number;
  amountMinor: number;
  currency: string;
  /** ISO. The Monday, in the fleet's zone. */
  weekStart: string;
  /** ISO. When the week closes, not when the money arrives. */
  endsAt: string;
  /**
   * Whether the target is cleared. Served rather than derived from
   * `trips >= tripTarget` here, because two implementations of one comparison
   * is one that gains a `>` and one that does not.
   */
  achieved: boolean;
};

/**
 * Tonight's peak window and what it pays (ADR-0036).
 *
 * The instants are **resolved by the server**. The app is never handed
 * `17:00` plus a zone name to re-derive from, because a rule that lives in a
 * handset goes on asserting the old number after the office changes it.
 */
export type PeakHours = {
  /** ISO. */
  startsAt: string;
  /** ISO. On the *following day* for a window that wraps past midnight. */
  endsAt: string;
  /** Whether the window was open at the moment of the request. */
  active: boolean;
  /**
   * A number, not a sentence. The server sends the figure and this app owns
   * the wording, so "Earn 20% more" can be translated (PRODUCT.md).
   */
  upliftPercent: number;
};

/** This driver's referral code and how their introductions are doing (ADR-0037). */
export type ReferralOffer = {
  /** Eight characters, with no O, 0, I, 1 or L — it is read aloud and retyped. */
  code: string;
  /** Trips the person they introduce must complete before the reward is paid. */
  tripTarget: number;
  rewardAmountMinor: number;
  introduced: number;
  qualified: number;
  /**
   * Summed from what each qualified referral actually promised, never the
   * count times the current reward — the two differ after the office changes
   * the figure, and this is the half that is already owed.
   */
  earnedMinor: number;
};

/**
 * What the platform is currently offering this driver.
 *
 * **Every scheme is nullable, and null means "not running" — never zero.**
 * `docs/screen-rules.md` §1 refuses a zero standing in for a figure that does
 * not exist, so a fleet with no bonus scheme gets no Weekly Challenge card
 * rather than one reading "0 of 40 trips". A driver on a fleet running one
 * scheme sees one card, and that is correct rather than broken.
 */
export type DriverPromotions = {
  /** ISO 4217. Every minor-unit amount below is in it. */
  currency: string;
  /** The fleet's zone. Every instant above is meant to be rendered against it. */
  timezone: string;
  weeklyChallenge: WeeklyChallenge | null;
  peakHours: PeakHours | null;
  referral: ReferralOffer | null;
};

/** The wire shape, snake_case, exactly as `DriverPromotions` in openapi.yaml. */
type PromotionsPayload = {
  currency: string;
  timezone: string;
  weekly_challenge: {
    trips: number;
    trip_target: number;
    amount_minor: number;
    currency: string;
    week_start: string;
    ends_at: string;
    achieved: boolean;
  } | null;
  peak_hours: {
    starts_at: string;
    ends_at: string;
    active: boolean;
    uplift_percent: number;
  } | null;
  referral: {
    code: string;
    trip_target: number;
    reward_amount_minor: number;
    introduced: number;
    qualified: number;
    earned_minor: number;
  } | null;
};

export async function fetchDriverPromotions(api: ApiClient): Promise<DriverPromotions> {
  const response = await api.request<PromotionsPayload>('/me/promotions');
  const payload = response.data;

  // Mapped rather than passed through, so the null-means-absent contract is
  // enforced in one place instead of at every render site. A scheme that is
  // off arrives as null and stays null.
  return {
    currency: payload.currency,
    timezone: payload.timezone,
    weeklyChallenge: payload.weekly_challenge
      ? {
          trips: payload.weekly_challenge.trips,
          tripTarget: payload.weekly_challenge.trip_target,
          amountMinor: payload.weekly_challenge.amount_minor,
          currency: payload.weekly_challenge.currency,
          weekStart: payload.weekly_challenge.week_start,
          endsAt: payload.weekly_challenge.ends_at,
          achieved: payload.weekly_challenge.achieved,
        }
      : null,
    peakHours: payload.peak_hours
      ? {
          startsAt: payload.peak_hours.starts_at,
          endsAt: payload.peak_hours.ends_at,
          active: payload.peak_hours.active,
          upliftPercent: payload.peak_hours.uplift_percent,
        }
      : null,
    referral: payload.referral
      ? {
          code: payload.referral.code,
          tripTarget: payload.referral.trip_target,
          rewardAmountMinor: payload.referral.reward_amount_minor,
          introduced: payload.referral.introduced,
          qualified: payload.referral.qualified,
          earnedMinor: payload.referral.earned_minor,
        }
      : null,
  };
}

/**
 * One thing the office has told this driver (ADR-0039).
 *
 * **The inbox was already built** — `Modules/Notifications` has served it
 * since ADR-0007, `trip.offered` has been one of its types all along, and the
 * driver token has been allowed to reach it. Nothing about it is new here; the
 * app simply never had a screen for it.
 */
export type DriverNotification = {
  id: number;
  /** The stable name, so a screen can route by kind rather than by subject. */
  type: string;
  type_label: string;
  subject: string;
  body: string;
  /**
   * A relative, **console-local** path. The driver app deliberately does not
   * follow it: these URLs were written for the staff SPA, so "/bookings/12"
   * means nothing here and following it would land nowhere. The `context`
   * below is what the app routes on.
   */
  url: string | null;
  context: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

export type DriverNotificationPage = {
  notifications: DriverNotification[];
  /**
   * Served in `meta` beside the list rather than from a second endpoint — a
   * bell shows a count and a panel shows the list, and two round trips for one
   * panel is a round trip too many.
   *
   * Null when `meta` did not arrive, which the drawer draws as no dot at all:
   * an unloaded count and a count of zero must not look the same.
   */
  unread: number | null;
};

export async function fetchNotifications(api: ApiClient): Promise<DriverNotificationPage> {
  const response = await api.request<DriverNotification[], { unread: number }>('/notifications');

  return {
    notifications: response.data,
    unread: response.meta?.unread ?? null,
  };
}

/**
 * Marks one as read.
 *
 * PATCH on a plain integer, not a bound model: the server scopes the lookup to
 * the recipient, so another user's id answers 404 rather than a 403 that would
 * confirm the row exists.
 */
export async function markNotificationRead(api: ApiClient, id: number): Promise<void> {
  await api.request(`/notifications/${id}`, { method: 'PATCH' });
}

/**
 * Marks every unread one read — `PATCH` on the collection.
 *
 * PATCH rather than POST, and no verb in the path: it modifies members that
 * already exist rather than creating anything. The server answers with how
 * many it touched; the app ignores that number and refetches instead, because
 * a count the driver has just made zero is not worth printing.
 *
 * Takes no id, like the index above: the route is bound to the authenticated
 * user and there is deliberately no way to name somebody else's inbox.
 */
export async function markAllNotificationsRead(api: ApiClient): Promise<void> {
  await api.request('/notifications', { method: 'PATCH' });
}

export async function fetchDriverStats(api: ApiClient): Promise<DriverStats> {
  const response = await api.request<DriverStats>('/me/stats');

  return response.data;
}

/**
 * `GET /me/performance` — the Performance screen's six dials and its weekly
 * card (ADR-0038).
 *
 * Hand-transcribed from `openapi.yaml` like every type in this file — see
 * `DriverStats` above for the drift that cost a live bug, and check the two
 * against each other rather than trusting `tsc`, which cannot see the server.
 *
 * ## The nulls are the contract
 *
 * Four fields here are nullable and **none of them may be defaulted to zero
 * in this app**. Each null means "there is no such number", and a zero would
 * be a claim:
 *
 * - a rate of `0` reads as a failing grade to a driver who has done nothing
 *   wrong on their first shift;
 * - `rostered_seconds_this_week: 0` would say the driver is rostered for no
 *   hours, where null says they have no roster at all (ADR-0017 §3);
 * - `bonus: null` means the scheme is switched off, and a card reading
 *   "0 of 40 trips" for a fleet that runs no bonus scheme is an invented
 *   figure dressed as a measurement.
 *
 * The screen draws no arc wherever a denominator is null. That is the whole
 * reason the server sends denominators rather than percentages.
 */
export type DriverPerformance = {
  /** 0–100, one decimal, over `window_days`. Null until there is something to divide by. */
  acceptance_rate: number | null;
  completion_rate: number | null;
  /**
   * **Not the complement of `completion_rate`.** `no_show` is the third
   * ending, so the two sum to 100 only for a driver who has never had one.
   * Never derive one from the other.
   */
  cancellation_rate: number | null;
  /** Mean of the last 50 ratings. **Null until five exist** (ADR-0030 §3). */
  rating: number | null;
  rating_count: number;
  window_days: number;
  /** Completed trips, ever. The same count `/me/profile` serves. */
  trips_total: number;
  /** Monday of the week in progress, `YYYY-MM-DD`, in `timezone`. */
  week_start: string;
  /** The **fleet's** zone. Served so a handset near a border does not draw its own week. */
  timezone: string;
  trips_this_week: number;
  /**
   * Duty-session seconds since `week_start` (ADR-0038).
   *
   * Conservative by design: it counts time the platform could actually reach
   * the driver, so a spell in a dead zone is lost. Seconds rather than a
   * formatted string, because rendering "7h 20m" is this app's job and
   * `durationLabel` already does it.
   */
  online_seconds_this_week: number;
  /** The **whole** week's roster. Null for a driver who has none. */
  rostered_seconds_this_week: number | null;
  /** Null when `billing.bonus_enabled` is off — the app then renders no card. */
  bonus: {
    trips: number;
    trip_target: number;
    amount_minor: number;
    currency: string;
    week_start: string;
    ends_at: string;
    /** Server-computed. Never re-derived here from `trips >= trip_target`. */
    achieved: boolean;
  } | null;
};

export async function fetchDriverPerformance(api: ApiClient): Promise<DriverPerformance> {
  const response = await api.request<DriverPerformance>('/me/performance');

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
   * Where to fetch this driver's photograph, or null (ADR-0041).
   *
   * A **route on the API**, not a storage URL: the file is on the private disk
   * and is streamed, because a signed link to a photograph of somebody is
   * addressable by anyone who ever saw it — and this one is loaded every time
   * the drawer opens, so the link would travel.
   *
   * Null is the ordinary case, not an error. A driver who has never sent one
   * gets their initials, which is what everybody had before this existed.
   */
  photo_url: string | null;
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
  | 'vehicle_registration'
  /**
   * The two ADR-0048 §1 added, and the naming rule that admitted them.
   *
   * ADR-0033 §1 closed the catalogue at four and said "a fifth type is one
   * case here" — an invitation with a condition attached: **nothing in the
   * catalogue may be named for one country.** *PSV badge*, *logbook* and
   * *third-party sticker* were refused on it. A face is a face in Kampala and
   * in Nairobi, and a photograph of a car is not a jurisdiction's paperwork.
   *
   * Neither carries an expiry, and that is not an oversight: expiry is
   * required where the document *is* its date, and a selfie has no date to
   * lapse.
   */
  | 'identity_selfie'
  | 'vehicle_photo';

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
export type DriverDocumentGroup = 'personal' | 'driver' | 'vehicle';

export type DriverDocumentSlot = {
  type: DriverDocumentType;
  type_label: string;
  /** What to photograph, in the driver's words rather than the schema's. */
  hint: string;
  /** Served rather than hardcoded here, so the rule lives in one place. */
  requires_expiry: boolean;
  /**
   * Which headed section this slot belongs under (ADR-0048 §1).
   *
   * **Served, not inferred here.** The driver app and the console both draw
   * these six rows, and two client-side copies of "which section is a selfie
   * in" would disagree the first time a seventh type is added. A handset that
   * has never heard of a new group still renders it, because
   * `groupSlots` orders by `group_label` rather than by a list of names it
   * holds.
   */
  group: DriverDocumentGroup | string;
  group_label: string;
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
  const response = await api.request<
    DriverDocumentSlot[],
    { compliance: DriverDocumentCompliance }
  >('/me/documents');

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

  // `formFile` rather than a `{ uri, name, type }` descriptor — Expo's fetch
  // refuses that shape outright, and did so here for as long as this endpoint
  // has existed. The whole argument is in `api/formFile.ts`.
  form.append('file', formFile(input.uri));

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
 * Where a driver's money is sent (ADR-0042), as its owner may see it.
 *
 * **The whole account number is never in this payload.** The server masks it to
 * the last four characters, and the office reads the full one from its own
 * endpoint — a driver confirming "yes, that is my account" needs the tail, not
 * a full account number echoed onto a handset that may be shared or read over a
 * shoulder at a stage.
 *
 * The three labels are **served, not spelled here**: the two kinds ask for
 * different words — nobody calls Stanbic a provider and nobody calls MTN a bank
 * — and a second copy of that mapping in this bundle is a second place for it
 * to be wrong.
 */
export type PayoutAccountKind = 'bank' | 'mobile_money';

export type DriverPayoutAccount = {
  kind: PayoutAccountKind;
  kind_label: string;
  /** "Bank" or "Provider". */
  institution_label: string;
  /** "Account number" or "Mobile money number". */
  number_label: string;
  institution: string;
  account_holder_masked: string;
  /** A mask and the last four characters. */
  account_number_masked: string;
  last_four: string;
  updated_at: string | null;
};

/**
 * Null for a driver who has given no details — a normal first visit, not an
 * error, and the screen renders it as an empty form.
 */
export async function fetchPayoutAccount(api: ApiClient): Promise<DriverPayoutAccount | null> {
  const response = await api.request<{ payout_account: DriverPayoutAccount | null }>(
    '/me/payout-account',
  );

  return response.data.payout_account;
}

/**
 * Sets or replaces it.
 *
 * **Every field, every time.** The server refuses a partial save, and the
 * reason is worth keeping in the client too: changing the bank while leaving
 * last month's account number is a working destination pointing at the wrong
 * place, which is the worst state this record can hold.
 *
 * Outside the offline outbox, like the password change and the two uploads.
 * ADR-0023 queues trip transitions; a bank account applied silently three hours
 * later is not something to find out about from a payment.
 */
export async function savePayoutAccount(
  api: ApiClient,
  input: {
    kind: PayoutAccountKind;
    institution: string;
    account_holder: string;
    account_number: string;
  },
): Promise<DriverPayoutAccount> {
  const response = await api.request<{ payout_account: DriverPayoutAccount }>(
    '/me/payout-account',
    {
      method: 'PUT',
      body: input,
    },
  );

  return response.data.payout_account;
}

/** Removes it. Answers the same shape whether or not one was held. */
export async function deletePayoutAccount(api: ApiClient): Promise<null> {
  await api.request<{ payout_account: null }>('/me/payout-account', { method: 'DELETE' });

  return null;
}

/**
 * Closing the account, driver's side (ADR-0043).
 *
 * **Nothing here closes anything.** Asking writes a row; the office's
 * confirmation is what deactivates the driver, and by then they cannot sign in
 * to be told — so the answer arrives by email. The screen must never imply
 * otherwise, and neither must these names: `requestClosure`, not `closeAccount`.
 *
 * **And "delete" does not mean erased.** ADR-0043's opening constraint is that
 * a hard delete is not available to this platform at any price: trips, ledger
 * entries and invoices survive, because reproducible invoices are what the
 * anchor client is buying. Closure plus anonymisation on the retention
 * schedule is the honest shape, and the screen says so in as many words.
 */
export type ClosureRequestStatus = 'pending' | 'confirmed' | 'declined' | 'withdrawn';

export type DriverClosureRequest = {
  id: number;
  status: ClosureRequestStatus;
  /** The server's word for the status — "Waiting for the office", "Not closed". */
  status_label: string;
  /** The driver's own, optional: requiring a reason to leave is a dark pattern. */
  reason: string | null;
  /** Required of the office when it declines, so a refusal is actionable. */
  decline_reason: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  closed_at: string | null;
};

/**
 * The **latest** request, or null for a driver who has never asked.
 *
 * Latest rather than only-open, and that is the server's design: a driver whose
 * request was declined needs to read why more than they need the row to vanish.
 */
export async function fetchClosureRequest(api: ApiClient): Promise<DriverClosureRequest | null> {
  const response = await api.request<{ closure_request: DriverClosureRequest | null }>(
    '/me/closure-request',
  );

  return response.data.closure_request;
}

/**
 * Asks. 409 `CLOSURE_REQUEST_ALREADY_OPEN` when one is already waiting.
 *
 * Outside the offline outbox, like the password change and the payout account.
 * ADR-0023 queues trip transitions; a request to close an account, sent silently
 * three hours later from a queue, is not something to find out about from an
 * email.
 */
export async function requestClosure(
  api: ApiClient,
  reason: string | null,
): Promise<DriverClosureRequest> {
  const response = await api.request<{ closure_request: DriverClosureRequest }>(
    '/me/closure-request',
    {
      method: 'POST',
      // Omitted rather than sent as an empty string: the rule is `nullable`,
      // and "" would be stored as a reason the driver did not give.
      body: reason === null || reason.trim() === '' ? {} : { reason: reason.trim() },
    },
  );

  return response.data.closure_request;
}

/**
 * Taking it back. 404 when nothing is waiting, 409
 * `CLOSURE_REQUEST_ALREADY_DECIDED` when the office answered first.
 *
 * `DELETE` on the singular resource, matching the route: unlike the office's
 * confirm and decline — decisions with their own audit meaning — this is
 * somebody taking back their own ask.
 */
export async function withdrawClosureRequest(api: ApiClient): Promise<DriverClosureRequest> {
  const response = await api.request<{ closure_request: DriverClosureRequest }>(
    '/me/closure-request',
    { method: 'DELETE' },
  );

  return response.data.closure_request;
}

/**
 * A driver correcting their own name or phone number.
 *
 * **Two fields, and the omissions are the server's design.** The office's own
 * form accepts seven; `license_number`, `license_expiry`, `status`,
 * `vehicle_id` and `email` are refused with a 422 that names the field, not
 * dropped silently — so a client that sends one finds out rather than reading
 * an unchanged body as a race.
 *
 * Sent as a partial: either field may travel alone, so correcting a phone
 * number cannot blank a name.
 *
 * **Outside the offline outbox**, like the password change and the two uploads.
 * ADR-0023 queues trip transitions, whose whole point is surviving a tunnel. A
 * name correction that silently applied three hours later — after the driver
 * had given up and retyped it — would be a worse answer than a refusal.
 */
export async function updateDriverProfile(
  api: ApiClient,
  changes: { name?: string; phone?: string },
): Promise<DriverProfile> {
  const response = await api.request<DriverProfile>('/me/profile', {
    method: 'PATCH',
    body: changes,
  });

  return response.data;
}

/**
 * The driver's own photograph, replacing whatever is there (ADR-0041).
 *
 * Outside the offline outbox for the same reason `uploadDriverDocument` is,
 * and the screen says so. Four megabytes rather than the document ceiling's
 * eight — `StoreDriverPhotoRequest` halves it deliberately, because a portrait
 * is rendered at 64 points and never read, and the driver is paying for the
 * data.
 *
 * **The file part is built by `formFile`, shared with the document upload and
 * the odometer photo.** Naming and typing the file is the file's own job now
 * rather than three guesses made from the end of a uri — see that module for
 * why the guesses had to go.
 */
export async function uploadDriverPhoto(
  api: ApiClient,
  uri: string,
): Promise<{ photo_url: string | null }> {
  const form = new FormData();

  form.append('file', formFile(uri));

  const response = await api.request<{ photo_url: string | null }>('/me/photo', {
    method: 'POST',
    form,
    timeoutMs: 60_000,
  });

  return response.data;
}

/**
 * Takes the driver's photograph down.
 *
 * The server answers `photo_url: null` whether or not one was held, so this
 * needs no "was there one" check and cannot fail for the driver who taps it
 * twice.
 */
export async function deleteDriverPhoto(api: ApiClient): Promise<{ photo_url: string | null }> {
  const response = await api.request<{ photo_url: string | null }>('/me/photo', {
    method: 'DELETE',
  });

  return response.data;
}

/**
 * One report a driver sent the office, and the answer if it has one (ADR-0044).
 *
 * **`answer: null` means "still waiting", never "refused quietly".** The server
 * has no way to close a report without writing one — ADR-0044 §2 removed the
 * third status on purpose — so the null is a fact about the office's queue and
 * not about a missing field.
 */
export type SupportRequest = {
  id: number;
  topic: string;
  topic_label: string;
  status: 'open' | 'answered';
  status_label: string;
  /** The journey it is about, or null. */
  trip_id: number | null;
  /** The driver's own words, verbatim. */
  body: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

/** The driver's own reports, newest first. Capped server-side at fifty. */
export async function fetchSupportRequests(api: ApiClient): Promise<SupportRequest[]> {
  const response = await api.request<SupportRequest[]>('/me/support-requests');

  return response.data;
}

/**
 * Sends a report to the office.
 *
 * **Deliberately not through the offline outbox** (ADR-0044 §5). ADR-0023's
 * queue carries small trip transitions that must survive a dead zone; a driver
 * writing an account of something that happened to them needs to know it
 * arrived, and a report sitting in a queue for three hours while they believe
 * the office has it is worse than being told to try again on signal.
 *
 * `trip_id` is omitted rather than sent as null when there is none — the
 * contract accepts either, and an absent optional reads better in a request log
 * than an explicit null.
 */
export async function createSupportRequest(
  api: ApiClient,
  input: { topic: string; body: string; tripId?: number | null },
): Promise<SupportRequest> {
  const response = await api.request<SupportRequest>('/me/support-requests', {
    method: 'POST',
    body: {
      topic: input.topic,
      body: input.body,
      ...(input.tripId === undefined || input.tripId === null ? {} : { trip_id: input.tripId }),
    },
  });

  return response.data;
}
