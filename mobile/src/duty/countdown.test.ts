import { isRunningOut, secondsRemaining } from './countdown';

/**
 * The offer countdown, tested where the risk actually lives.
 *
 * The failure being guarded against is invisible in development and common in
 * the field: a handset whose clock is minutes out. Every device in an office
 * is NTP-synced; plenty of cheap Android hardware in a taxi is not.
 */

it('counts from the duration the server measured', () => {
  expect(secondsRemaining({ expires_in_seconds: 15 }, 0)).toBe(15);
  expect(secondsRemaining({ expires_in_seconds: 15 }, 3)).toBe(12);
});

it('is unaffected by what the device thinks the time is', () => {
  // The point of the whole module. `expires_in_seconds` is a duration, so
  // there is no absolute instant here for a wrong clock to be wrong about —
  // and no parameter this function could take to make it wrong.
  //
  // Mutation check: change `secondsRemaining` to derive from `expires_at`
  // and the local clock, and this suite stops compiling — which is the point
  // of the argument being a duration rather than a timestamp.
  const offer = { expires_in_seconds: 15 };

  expect(secondsRemaining(offer, 1)).toBe(14);
});

it('never counts past zero', () => {
  // A negative countdown says the platform has lost track of the job, rather
  // than that the job is gone. The list is what removes an expired offer:
  // the server stops returning it.
  expect(secondsRemaining({ expires_in_seconds: 2 }, 30)).toBe(0);
  expect(secondsRemaining({ expires_in_seconds: 0 }, 0)).toBe(0);
});

it('refuses a negative number from either side', () => {
  // The server clamps its own field, and a client that trusts a remote number
  // to be in range renders "-3s" the day somebody changes the resource.
  expect(secondsRemaining({ expires_in_seconds: -5 }, 0)).toBe(0);
  expect(secondsRemaining({ expires_in_seconds: 15 }, -5)).toBe(15);
});

it('warns only in the last five seconds', () => {
  expect(isRunningOut(15)).toBe(false);
  expect(isRunningOut(6)).toBe(false);
  expect(isRunningOut(5)).toBe(true);
  expect(isRunningOut(0)).toBe(true);
});