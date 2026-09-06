import type { DispatchOffer } from '../api/types';
import { buildCallContent, callNotificationId, offerIdFromCallNotificationId } from './callContent';

/**
 * What the incoming-call notification says, and which job it belongs to
 * (ADR-0049 §3).
 *
 * The half of the call screen that can be tested. `callNotification.ts` holds
 * the native calls and is deliberately left with nothing to decide.
 */

function offer(over: Partial<DispatchOffer> = {}): DispatchOffer {
  return {
    id: 41,
    status: 'offered',
    expires_at: '2026-08-21T09:00:45Z',
    expires_in_seconds: 45,
    pickup: { label: 'Kampala Road', latitude: 0.3136, longitude: 32.5811 },
    dropoff: { label: 'Ntinda', latitude: 0.3536, longitude: 32.6111 },
    service_type: 'ride',
    reference: 'TRP-0001',
    pickup_distance_km: 2.4,
    trip_distance_km: 6,
    reasons: [],
    package: null,
    payment: { payment_method: 'cash', payer: 'passenger' },
    estimated_fare: {
      vehicle_category: 'sedan',
      distance_km: 6,
      total_minor: 12500,
      currency: 'UGX',
      is_estimate: true,
      basis: 'Straight-line distance.',
    },
    vehicle_id: null,
    ...over,
  } as DispatchOffer;
}

describe('callNotificationId', () => {
  it('round-trips an offer id', () => {
    expect(offerIdFromCallNotificationId(callNotificationId(41))).toBe(41);
  });

  /**
   * The handler that answers a job is handed a notification id by Android and
   * has to decide *which job*. A lenient parse here answers the wrong one.
   */
  it.each([
    ['a notification belonging to something else', 'trip-41'],
    ['a bare number', '41'],
    ['an id with a suffix', 'offer-call-41-x'],
    ['a non-numeric id', 'offer-call-abc'],
    ['zero', 'offer-call-0'],
    ['nothing at all', undefined],
    ['a number rather than a string', 41],
  ])('refuses %s', (_label, id) => {
    expect(offerIdFromCallNotificationId(id)).toBeNull();
  });
});

describe('buildCallContent', () => {
  /**
   * The numbers first, the prose last — the owner's reference design
   * (worklog, 2026-08-22). Android truncates the line from the end, so this
   * order is what keeps the fare on screen when the pickup label is long.
   */
  it('leads with the fare and the run, then where it starts', () => {
    const content = buildCallContent(offer());

    expect(content).not.toBeNull();
    expect(content?.title).toBe('New ride request');
    expect(content?.body).toBe('UGX 12,500 · 6.0 km trip · 2.4 km away · Pickup: Kampala Road');
    expect(content?.id).toBe('offer-call-41');
    expect(content?.offerId).toBe(41);
  });

  it('names a delivery as a delivery', () => {
    expect(buildCallContent(offer({ service_type: 'delivery' }))?.title).toBe(
      'New delivery request',
    );
  });

  /**
   * **The failure ADR-0046 §2 calls worse than never ringing.** A push held
   * while a handset was in a dead zone must never wake a phone for a job
   * somebody else has been driving for ten minutes.
   */
  it.each([
    ['an expired offer', 0],
    ['an offer whose clock has run past', -3],
    ['a window that is not a number', Number.NaN],
  ])('shows nothing for %s', (_label, seconds) => {
    expect(buildCallContent(offer({ expires_in_seconds: seconds }))).toBeNull();
  });

  /**
   * Android reads `timeoutAfter: 0` as "no timeout" and leaves the
   * notification on the lock screen forever, so the window must never reach
   * the native call as zero. Guaranteed by the null above, checked here.
   */
  it('outlives the offer by a small grace rather than dying with it', () => {
    const content = buildCallContent(offer({ expires_in_seconds: 45 }));

    expect(content?.timeoutMs).toBe(47_000);
  });

  /**
   * Every fact on the body is genuinely optional. A job taken over the phone
   * has no coordinates and a category nobody priced has no fare — and
   * "Pickup: null · null km away" is what makes a driver stop believing the
   * rest of the notification.
   */
  it('drops the facts it does not have rather than rendering them empty', () => {
    const content = buildCallContent(
      offer({ pickup_distance_km: null, estimated_fare: null, trip_distance_km: null }),
    );

    expect(content?.body).toBe('Pickup: Kampala Road');
  });

  it('drops a pickup label that is only whitespace', () => {
    const content = buildCallContent(
      offer({ pickup: { label: '   ', latitude: null, longitude: null } }),
    );

    expect(content?.body).toBe('UGX 12,500 · 6.0 km trip · 2.4 km away');
  });

  it('still says something when nothing is known', () => {
    const content = buildCallContent(
      offer({
        pickup: { label: null, latitude: null, longitude: null },
        pickup_distance_km: null,
        trip_distance_km: null,
        estimated_fare: null,
      }),
    );

    expect(content?.body).toBe('A passenger is waiting.');
  });

  /**
   * A driver standing on top of the pickup is a real and common case at a
   * stage. "0.0 km away" reads as a bug; `formatKilometres` says the true
   * thing and this must not paste a unit onto it.
   */
  it('reads correctly when the driver is almost on the pickup', () => {
    const content = buildCallContent(offer({ pickup_distance_km: 0.04 }));

    expect(content?.body).toContain('Under 100 m away');
  });
});
