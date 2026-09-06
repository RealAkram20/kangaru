import { act, renderHook } from '@testing-library/react-native';

import { useHandover, type HandoverStep } from './handover';

/**
 * The hand-over's timing, which is the whole of what can go wrong with it.
 *
 * The surface is a rail and two lines of text; this is the part that decides
 * whether a driver ever sees them, and every rule it enforces is one that
 * `docs/screen-rules.md` would otherwise be broken by:
 *
 * - a warm cache must never see it at all (§5: not on a high-frequency
 *   surface);
 * - a slow route must never hold the passenger's phone number;
 * - and it must not come back over a map the driver is already reading.
 *
 * Fake timers throughout, so the delay, the floor and the ceiling are asserted
 * rather than waited for. Everything that advances them goes inside
 * `act(...)` — `waitFor` under fake timers never resolves.
 */

jest.useFakeTimers();

/** The two steps `PickupScreen` passes, as data. */
function steps(connecting: boolean, routing: boolean): HandoverStep[] {
  return [
    { label: 'Connecting to the passenger', pending: connecting },
    { label: 'Finding the road to the pickup', pending: routing },
  ];
}

it('never appears when the answers were already on the phone', async () => {
  // The twentieth job of a shift: both queries resolve from cache, nothing is
  // outstanding on the first render, and the driver is simply on the screen.
  // This is the assertion that keeps the moment clear of §5.
  const { result } = await renderHook(() => useHandover(steps(false, false)));

  expect(result.current.visible).toBe(false);

  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });

  expect(result.current.visible).toBe(false);
});

it('stays away while a request settles inside the delay', async () => {
  // A fast connection is not a cache hit, but it is close enough that
  // announcing it would be a flash rather than an answer.
  const { result, rerender } = await renderHook(
    ({ routing }: { routing: boolean }) => useHandover(steps(false, routing)),
    { initialProps: { routing: true } },
  );

  await act(async () => {
    jest.advanceTimersByTime(80);
  });

  expect(result.current.visible).toBe(false);

  await rerender({ routing: false });

  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });

  expect(result.current.visible).toBe(false);
});

it('appears, and reports the step actually outstanding', async () => {
  const { result } = await renderHook(() => useHandover(steps(true, true)));

  await act(async () => {
    jest.advanceTimersByTime(150);
  });

  expect(result.current.visible).toBe(true);
  expect(result.current.label).toBe('Connecting to the passenger');
  expect(result.current.step).toBe(0);
  expect(result.current.total).toBe(2);
});

it('moves to the road once the trip has landed', async () => {
  const { result, rerender } = await renderHook(
    ({ connecting }: { connecting: boolean }) => useHandover(steps(connecting, true)),
    { initialProps: { connecting: true } },
  );

  await act(async () => {
    jest.advanceTimersByTime(150);
  });

  expect(result.current.step).toBe(0);

  await rerender({ connecting: false });

  expect(result.current.label).toBe('Finding the road to the pickup');
  expect(result.current.step).toBe(1);
});

it('holds long enough to be read, then stands down', async () => {
  const { result, rerender } = await renderHook(
    ({ routing }: { routing: boolean }) => useHandover(steps(false, routing)),
    { initialProps: { routing: true } },
  );

  await act(async () => {
    jest.advanceTimersByTime(150);
  });

  expect(result.current.visible).toBe(true);

  // The road lands almost immediately after the moment appeared. Without the
  // floor this is a full screen that existed for one frame, which reads as the
  // app glitching rather than as an answer.
  await rerender({ routing: false });

  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  expect(result.current.visible).toBe(true);

  await act(async () => {
    jest.advanceTimersByTime(400);
  });

  expect(result.current.visible).toBe(false);
});

it('gives the screen back rather than waiting out a slow route', async () => {
  // The trap this closes. The API client allows fifteen seconds; the public
  // routing server is rate-limited. A driver whose passenger is not at the
  // kerb needs the phone number, and the map has always been able to draw its
  // dashed line without a road.
  const { result } = await renderHook(() => useHandover(steps(false, true)));

  await act(async () => {
    jest.advanceTimersByTime(150);
  });

  expect(result.current.visible).toBe(true);

  await act(async () => {
    jest.advanceTimersByTime(4_100);
  });

  expect(result.current.visible).toBe(false);
});

it('does not come back when the driver moves and the route refetches', async () => {
  // `useTripRoute` is keyed on the snapped position, so every ~100 m is a new
  // query in a pending state. Reappearing over a map the driver is reading is
  // worse than never having shown at all.
  const { result, rerender } = await renderHook(
    ({ routing }: { routing: boolean }) => useHandover(steps(false, routing)),
    { initialProps: { routing: true } },
  );

  await act(async () => {
    jest.advanceTimersByTime(150);
  });

  await rerender({ routing: false });

  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  expect(result.current.visible).toBe(false);

  // A hundred metres later.
  await rerender({ routing: true });

  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });

  expect(result.current.visible).toBe(false);
});

it('reports one step as one step, for the arrival seam', async () => {
  // `WaitingForPassengerScreen` has only the fare route to wait for — the trip
  // is already on the phone by the time a driver is standing at a kerb.
  const { result } = await renderHook(() =>
    useHandover([{ label: "Switching to the passenger's route", pending: true }]),
  );

  await act(async () => {
    jest.advanceTimersByTime(150);
  });

  expect(result.current.visible).toBe(true);
  expect(result.current.total).toBe(1);
  expect(result.current.step).toBe(0);
});
