import type { DriverPresence } from '../api/types';

/**
 * One presence heartbeat, with everything native injected (ADR-0024 §2).
 *
 * ## Why this was extracted from `PresenceController`
 *
 * Because there are now **two** callers, running in two different worlds, and
 * they must not answer the question differently.
 *
 * - `PresenceController` — a React component, mounted in the authenticated
 *   shell, ticking on a `setInterval` while somebody is looking at the app.
 * - `PresenceTask` — an `expo-task-manager` task, woken by the OS with no
 *   React tree, no query cache and no provider above it, while the phone is
 *   in a pocket.
 *
 * A second copy of this would have drifted, and the half that would have
 * drifted first is the one nobody watches: the background path. Its bugs are
 * invisible by construction — a driver cannot see a heartbeat that was not
 * sent, they can only see that the jobs stopped coming.
 *
 * ## Why the ports are injected rather than imported
 *
 * `jest.setup.ts` records the rule this follows: the suites in this app worth
 * trusting are "pure TypeScript over injected ports", because the alternative
 * is a component test that renders concurrently, awaits a flush and drives
 * fake timers through `act` — three things that fail for reasons having
 * nothing to do with the arithmetic under test.
 *
 * This module is the arithmetic. `expo-location` and the API client are the
 * caller's problem.
 *
 * ## Why it returns an outcome instead of throwing
 *
 * Every one of these endings is *ordinary*, and the two callers react to them
 * differently — the controller writes a fresh duty record into the query
 * cache, the background task has no cache to write to and simply stops. An
 * exception would flatten that distinction into a `catch` and lose which of
 * them happened, which is exactly the information the field needs when a
 * driver reports "the app says I'm online but I get no jobs".
 */

/** A position fix, in the shape both callers can produce without adapting. */
export type PresenceFix = {
  latitude: number;
  longitude: number;
  /** Metres, or null when the platform declines to say. */
  accuracyMetres: number | null;
  /** Milliseconds since the epoch, from the device that took the fix. */
  timestamp: number;
};

export type PresencePorts = {
  /**
   * Whether location is granted — **read, never requested.**
   *
   * A permission dialog appearing out of a background timer, minutes after
   * the driver last touched the app, is a dialog nobody can connect to
   * anything they did. `useDutyToggle` asks at the moment they sign on,
   * which is the moment it makes sense.
   */
  hasPermission: () => Promise<boolean>;
  /** A fresh fix, or null if the platform could not produce one. */
  getFix: () => Promise<PresenceFix | null>;
  send: (input: {
    latitude: number;
    longitude: number;
    accuracyMetres: number | null;
    recordedAt: string;
    vehicleId: number | null;
  }) => Promise<DriverPresence>;
  /** True when the thrown error was the server's 409 NOT_ON_DUTY. */
  isNotOnDuty: (error: unknown) => boolean;
};

export type PresenceOutcome =
  /** Sent, and the server's answer — the duty record — came back. */
  | { kind: 'sent'; presence: DriverPresence }
  /**
   * The driver refused location, and **this is not an error.** The server
   * keeps them dispatchable without coordinates and ranks them without
   * distance (ADR-0024 §2). Signing them off here would be this app inventing
   * a rule the platform does not have — a silent, per-driver outage.
   */
  | { kind: 'no_permission' }
  /** Indoors, in a basement, in a tunnel. The next tick is the answer. */
  | { kind: 'no_fix' }
  /**
   * The server says this shift is over. The caller stops rather than retries:
   * arguing with the authority on duty state is how a background task ends up
   * pinging forever for a driver who went home.
   */
  | { kind: 'off_duty' }
  /** A dead zone. Deliberately not retried — see below. */
  | { kind: 'unreachable' };

export async function reportPresence(
  ports: PresencePorts,
  vehicleId: number | null,
): Promise<PresenceOutcome> {
  if (!(await ports.hasPermission())) {
    return { kind: 'no_permission' };
  }

  const fix = await ports.getFix();

  if (fix === null) {
    return { kind: 'no_fix' };
  }

  try {
    const presence = await ports.send({
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyMetres: fix.accuracyMetres,
      // **The device's clock, matching the field's contract.** The server
      // judges staleness against this, so sending a server-side "now" would
      // make every ping look fresh at the moment it arrived — exactly the lie
      // the field exists to prevent.
      //
      // This is the opposite of the rule `countdown.ts` follows, and the two
      // are consistent: there, a *duration* is trusted over a wrong clock;
      // here, the server is being told when the fix was taken so it can judge
      // for itself. Substituting arrival time would remove its ability to.
      recordedAt: new Date(fix.timestamp).toISOString(),
      vehicleId,
    });

    return { kind: 'sent', presence };
  } catch (error) {
    if (ports.isNotOnDuty(error)) {
      return { kind: 'off_duty' };
    }

    // **Never retried here, and that is the whole design.** These pings must
    // not be replayed: a backlog of positions from a tunnel describes where
    // the driver *was*, and dispatching against it sends a passenger a car
    // that has driven on. The next tick is a better answer than a retry of a
    // position that is already out of date.
    //
    // This is the deliberate inverse of the GPS pipeline, whose pings queue
    // in SQLite because losing one loses billing evidence. Same subsystem,
    // opposite durability, for reasons `PresenceController` sets out at
    // length.
    return { kind: 'unreachable' };
  }
}
