import AsyncStorage from '@react-native-async-storage/async-storage';

const SHIFT_KEY = 'kangaruride.driver.shift';

/**
 * What the background task needs to know, written down where it can read it.
 *
 * ## Why this exists at all
 *
 * `PresenceTask` is woken by the operating system, not by React. There is no
 * component tree above it, no `AuthProvider`, no query cache and no
 * `useDuty()` — the app's entire notion of "which vehicle, how often" lives
 * in a React context the task cannot reach. So the two facts it needs are
 * mirrored here, in storage both worlds can open.
 *
 * ## Why AsyncStorage rather than SecureStore
 *
 * Deliberately different from `auth/tokenStore`, which uses the platform
 * keystore because ADR-0022's threat model is a bearer credential at rest on
 * a lost handset. A vehicle id and a heartbeat interval are neither secret
 * nor useful to a thief — they authorise nothing. The same reasoning
 * `push/tokenStore` sets out for the push token, and the same conclusion:
 * putting them in the keystore would imply a protection they do not need and
 * cost a native call on a path that runs every minute of a shift.
 *
 * The **token** the task authenticates with is the exception and still comes
 * from SecureStore, because that one is a credential.
 *
 * ## Why it is a mirror and never an authority
 *
 * The server owns duty state — `PUT /me/duty` decides it and `GET /me/duty`
 * reports it, and ADR-0024 §2 is explicit that a shift survives whatever the
 * handset does. This record exists so a task woken at 06:00 knows which
 * vehicle to name; it is not consulted to decide whether a driver is working.
 * When the two disagree the server wins, and the task's own 409 handling is
 * what settles it — see `reportPresence`'s `off_duty` outcome.
 */
export type Shift = {
  onDuty: boolean;
  vehicleId: number | null;
  /** The server's own cadence, from `DriverPresence.heartbeat_seconds`. */
  heartbeatSeconds: number;
};

/**
 * The fallback when nothing has been written yet, or when storage is
 * unreadable.
 *
 * `onDuty: false` is the safe half of that choice: a task that reads this and
 * stops is a task that costs a driver one interval, and the foreground app
 * re-writes the record within seconds of being opened. The opposite default
 * would have a signed-out handset pinging the platform.
 */
const OFF: Shift = { onDuty: false, vehicleId: null, heartbeatSeconds: 60 };

export async function rememberShift(shift: Shift): Promise<void> {
  try {
    await AsyncStorage.setItem(SHIFT_KEY, JSON.stringify(shift));
  } catch {
    // Losing this costs the background task its vehicle id for one shift,
    // which the server tolerates — `vehicle_id` is nullable on the heartbeat
    // and it falls back to the driver's default. Not worth failing a
    // sign-on over.
  }
}

export async function readShift(): Promise<Shift> {
  try {
    const stored = await AsyncStorage.getItem(SHIFT_KEY);

    if (stored === null) {
      return OFF;
    }

    const parsed = JSON.parse(stored) as Partial<Shift>;

    // Read field by field rather than trusted wholesale. This record outlives
    // app versions — it is on disk across an update that may have changed the
    // shape — and a task that spreads a stale object gets `undefined` where
    // it expects a number, then sets an interval of `NaN` milliseconds and
    // pings in a tight loop. Cheap to prevent, expensive to notice.
    return {
      onDuty: parsed.onDuty === true,
      vehicleId: typeof parsed.vehicleId === 'number' ? parsed.vehicleId : null,
      heartbeatSeconds:
        typeof parsed.heartbeatSeconds === 'number' && parsed.heartbeatSeconds > 0
          ? parsed.heartbeatSeconds
          : OFF.heartbeatSeconds,
    };
  } catch {
    return OFF;
  }
}

/**
 * Signing off, from wherever it happened.
 *
 * Called on the duty toggle and on sign-out. The second matters more than it
 * looks: a shared handset whose previous driver's shift record survived would
 * have the background service reporting *their* vehicle's position under
 * whoever signs in next.
 */
export async function forgetShift(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SHIFT_KEY);
  } catch {
    // The task re-reads on every wake and the server's 409 stops it anyway.
  }
}
