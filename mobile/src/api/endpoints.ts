import type { ApiClient } from './client';
import type {
  AvailabilityBlock,
  AvailabilityKind,
  CursorMeta,
  DispatchOffer,
  DriverPresence,
  Trip,
  TripEvent,
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
