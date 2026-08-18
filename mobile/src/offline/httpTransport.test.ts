import type { ApiClient } from '../api/client';
import { buildTransitionForm, HttpOutboxTransport } from './httpTransport';
import type { OutboxItem, TransitionPayload } from './outboxTypes';

const COMPLETION: TransitionPayload = { to: 'trip_completed', odometer_end: 104_468 };

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'x',
    kind: 'trip_transition',
    streamKey: 'trip:42',
    payload: COMPLETION,
    tripId: 42,
    expectedFrom: 'trip_started',
    targetStatus: 'trip_completed',
    photoUri: 'file:///tmp/dash.jpg',
    state: 'pending',
    attempts: 1,
    inflightAt: null,
    nextAttemptAt: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: 0,
    sequence: 1,
    ...overrides,
  };
}

/** A stand-in for `ApiClient` that records the options it was handed. */
function fakeApi() {
  const calls: { path: string; options: Record<string, unknown> }[] = [];

  const api = {
    request: jest.fn(async (path: string, options: Record<string, unknown>) => {
      calls.push({ path, options });

      return { success: true as const, message: '', data: undefined };
    }),
  };

  return { api: api as unknown as ApiClient, calls };
}

describe('buildTransitionForm', () => {
  it('carries the odometer reading and the photo', () => {
    const form = buildTransitionForm(COMPLETION, 'file:///tmp/dash.jpg');

    expect(form.get('to')).toBe('trip_completed');
    // Multipart carries strings; the server's Form Request casts it back.
    expect(form.get('odometer_end')).toBe('104468');
    expect(form.get('odometer_photo')).not.toBeNull();
  });

  it('omits fields the transition does not use rather than sending empties', () => {
    const form = buildTransitionForm({ to: 'accepted' }, 'file:///tmp/dash.jpg');

    expect(form.get('odometer_end')).toBeNull();
    expect(form.get('notes')).toBeNull();
  });
});

describe('HttpOutboxTransport — the photo must never strand the reading', () => {
  it('sends the photo while attempts are within the allowance', async () => {
    const { api, calls } = fakeApi();

    await new HttpOutboxTransport(api).sendTransition(item({ attempts: 3 }), COMPLETION);

    expect(calls[0]?.options.form).toBeDefined();
    expect(calls[0]?.options.body).toBeUndefined();
  });

  /**
   * `TransitionTripRequest` makes the photo optional on the server side so a
   * camera that will not focus in the dark cannot strand a trip. The same
   * reasoning has to hold for a photo file the OS has since cleared out of its
   * cache: after repeated failures the reading goes without it, because the
   * reading is one of the anchor client's six acceptance criteria and the
   * photo is not.
   *
   * Mutation check — remove the `item.attempts <= PHOTO_ABANDON_AFTER_ATTEMPTS`
   * condition and this fails: the completion retries forever behind a file
   * that will never upload.
   */
  it('gives up on the photo and sends the number alone after repeated failures', async () => {
    const { api, calls } = fakeApi();
    const warnings: string[] = [];

    await new HttpOutboxTransport(api, (message) => warnings.push(message)).sendTransition(
      item({ attempts: 4 }),
      COMPLETION,
    );

    expect(calls[0]?.options.form).toBeUndefined();
    expect(calls[0]?.options.body).toEqual(COMPLETION);
    // And it says so. A photo dropped in silence is a photo nobody knows to
    // go and look for.
    expect(warnings).toHaveLength(1);
  });

  it('sends plain JSON when there was never a photo', async () => {
    const { api, calls } = fakeApi();

    await new HttpOutboxTransport(api).sendTransition(item({ photoUri: null }), COMPLETION);

    expect(calls[0]?.options.body).toEqual(COMPLETION);
    expect(calls[0]?.path).toBe('/trips/42/transitions');
  });
});
