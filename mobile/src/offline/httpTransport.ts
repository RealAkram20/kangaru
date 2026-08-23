import type { ApiClient } from '../api/client';
import {
  createAvailabilityRequest,
  fetchAvailabilityRequests,
  fetchTrip,
  withdrawAvailabilityRequest,
} from '../api/endpoints';
import { formFile } from '../api/formFile';
import type { AvailabilityBlock, Trip } from '../api/types';
import type { OutboxTransport } from './outbox';
import type { AvailabilityRequestPayload, OutboxItem, TransitionPayload } from './outboxTypes';

/**
 * After this many attempts, a transition is sent without its photo.
 *
 * The reading is one of the anchor client's six acceptance criteria and the
 * photo is not — `TransitionTripRequest` makes that call on the server side,
 * with the comment that "a camera that will not focus in the dark must not be
 * able to strand a trip". The same reasoning applies to a photo file the OS
 * has since cleared out of its cache directory: three failures in, the number
 * goes without it rather than never going at all.
 */
const PHOTO_ABANDON_AFTER_ATTEMPTS = 3;

export class HttpOutboxTransport implements OutboxTransport {
  constructor(
    private readonly api: ApiClient,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  async sendTransition(item: OutboxItem, payload: TransitionPayload): Promise<void> {
    const path = `/trips/${item.tripId}/transitions`;
    const attachPhoto = item.photoUri !== null && item.attempts <= PHOTO_ABANDON_AFTER_ATTEMPTS;

    if (item.photoUri !== null && !attachPhoto) {
      this.warn(
        `Trip ${item.tripId}: sending the odometer reading without its photo after ` +
          `${item.attempts} failed attempts. The reading is the acceptance criterion; the photo is not.`,
      );
    }

    if (!attachPhoto) {
      await this.api.request(path, { method: 'POST', body: payload });

      return;
    }

    await this.api.request(path, {
      method: 'POST',
      form: buildTransitionForm(payload, item.photoUri as string),
      // A dashboard photo on an upcountry connection. The default 15 seconds
      // would abandon uploads that were making progress, and every abandoned
      // one costs a reconciling GET on the next attempt.
      timeoutMs: 60_000,
    });
  }

  fetchTrip(tripId: number): Promise<Trip> {
    return fetchTrip(this.api, tripId);
  }

  async sendAvailabilityRequest(payload: AvailabilityRequestPayload): Promise<void> {
    await createAvailabilityRequest(this.api, payload);
  }

  listAvailabilityRequests(): Promise<AvailabilityBlock[]> {
    return fetchAvailabilityRequests(this.api);
  }

  withdrawAvailabilityRequest(id: number): Promise<void> {
    return withdrawAvailabilityRequest(this.api, id);
  }
}

/**
 * The multipart body for a transition carrying a dashboard photo.
 *
 * Every value is appended as a string because that is all multipart carries;
 * the server's Form Request casts them back. `cancellation_charge_applicable`
 * is not sent by this app at all — a driver cannot cancel (ADR-0022 and
 * `TripPolicy`), so the field would never be true.
 */
export function buildTransitionForm(payload: TransitionPayload, photoUri: string): FormData {
  const form = new FormData();

  form.append('to', payload.to);

  if (payload.notes !== undefined) {
    form.append('notes', payload.notes);
  }

  if (payload.odometer_start !== undefined) {
    form.append('odometer_start', String(payload.odometer_start));
  }

  if (payload.odometer_end !== undefined) {
    form.append('odometer_end', String(payload.odometer_end));
  }

  // Dead today — a pause never carries a photo, so a stop_id never rides the
  // multipart path — but a payload field the builder silently drops is the
  // kind of gap that outlives the assumption. Guarded like its siblings.
  if (payload.stop_id !== undefined) {
    form.append('stop_id', String(payload.stop_id));
  }

  // `formFile`, not a `{ uri, name, type }` descriptor — Expo's fetch throws on
  // that shape, and this is the path where the throw costs most: it happens
  // inside the outbox, long after the driver has left the vehicle. The whole
  // argument is in `api/formFile.ts`.
  form.append('odometer_photo', formFile(photoUri));

  return form;
}
