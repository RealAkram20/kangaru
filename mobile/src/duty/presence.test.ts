import { reportPresence, type PresenceFix, type PresencePorts } from './presence';

/**
 * The heartbeat, over fake ports.
 *
 * This is the suite that stands behind the background task, which is the half
 * of presence nobody can watch: a driver cannot see a ping that was not sent,
 * they can only see that the jobs stopped coming. Every ending is asserted,
 * including the three that are not errors.
 */

const FIX: PresenceFix = {
  latitude: 0.3476,
  longitude: 32.5825,
  accuracyMetres: 12,
  // 19 Aug 2026, 09:15:30 UTC. A fixed instant, not `Date.now()` — the
  // assertion below is on the exact string the server receives.
  timestamp: Date.UTC(2026, 7, 19, 9, 15, 30),
};

function ports(overrides: Partial<PresencePorts> = {}): PresencePorts {
  return {
    hasPermission: jest.fn(async () => true),
    getFix: jest.fn(async () => FIX),
    send: jest.fn(async () => ({ on_duty: true, dispatchable: true }) as never),
    isNotOnDuty: () => false,
    ...overrides,
  };
}

it('sends the fix and hands back the duty record the server answered with', async () => {
  const presence = { on_duty: true, dispatchable: true } as never;
  const send = jest.fn(async () => presence);

  const outcome = await reportPresence(ports({ send }), 7);

  expect(outcome).toEqual({ kind: 'sent', presence });
  expect(send).toHaveBeenCalledWith({
    latitude: 0.3476,
    longitude: 32.5825,
    accuracyMetres: 12,
    recordedAt: '2026-08-19T09:15:30.000Z',
    vehicleId: 7,
  });
});

it("stamps the fix's own clock reading, not the moment the request went out", async () => {
  // The server judges staleness against `recorded_at`. If this were the time
  // of *sending*, a ping delayed thirty seconds by a slow radio would arrive
  // looking fresh — and a driver who lost signal at 07:00 would keep winning
  // the proximity ranking all morning, which is the precise failure
  // `presence_ttl_seconds` exists to prevent.
  const send = jest.fn(async () => ({}) as never);
  const stale = { ...FIX, timestamp: Date.UTC(2026, 7, 19, 9, 0, 0) };

  await reportPresence(ports({ send, getFix: async () => stale }), null);

  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ recordedAt: '2026-08-19T09:00:00.000Z' }),
  );
});

// -- The three endings that are not errors ---------------------------------

it('never asks for permission it does not have, and never sends without one', async () => {
  // A permission dialog out of a background timer is one nobody can connect
  // to anything they did. `useDutyToggle` asks when the driver signs on.
  const send = jest.fn();

  const outcome = await reportPresence(
    ports({ hasPermission: async () => false, send }),
    null,
  );

  expect(outcome).toEqual({ kind: 'no_permission' });
  expect(send).not.toHaveBeenCalled();
});

it('reports no fix rather than sending a position it does not have', async () => {
  const send = jest.fn();

  const outcome = await reportPresence(ports({ getFix: async () => null, send }), null);

  expect(outcome).toEqual({ kind: 'no_fix' });
  expect(send).not.toHaveBeenCalled();
});

it("distinguishes the server ending the shift from a dead zone", async () => {
  // The two look identical to a `catch`, and the callers must treat them
  // oppositely: off duty stops the task, unreachable waits for the next tick.
  // Collapsing them is how a background task pings forever for a driver who
  // went home.
  const conflict = new Error('NOT_ON_DUTY');

  const ended = await reportPresence(
    ports({
      send: async () => {
        throw conflict;
      },
      isNotOnDuty: (error) => error === conflict,
    }),
    null,
  );

  const deadZone = await reportPresence(
    ports({
      send: async () => {
        throw new Error('Network request failed');
      },
    }),
    null,
  );

  expect(ended).toEqual({ kind: 'off_duty' });
  expect(deadZone).toEqual({ kind: 'unreachable' });
});

it('does not retry a failed send, because a replayed position is a lie', async () => {
  // A backlog of positions from a tunnel describes where the driver *was*,
  // and dispatching against it sends a passenger a car that has driven on.
  // Deliberately the inverse of the GPS pipeline, which queues in SQLite.
  const send = jest.fn(async () => {
    throw new Error('Network request failed');
  });

  await reportPresence(ports({ send }), null);

  expect(send).toHaveBeenCalledTimes(1);
});
