import type { ApiClient } from './client';
import type {
  AvailabilityBlock,
  AvailabilityKind,
  CursorMeta,
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
