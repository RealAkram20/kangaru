import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useTripRoute } from './queries';

/**
 * That a failed route comes back on its own.
 *
 * The trap this closes, found on the owner's handset while the API was down.
 * `useTripRoute` is keyed on the driver's snapped position so that a route is
 * re-asked only when they have genuinely moved — but
 * `WaitingForPassengerScreen` asks with **no position at all**, deliberately:
 * the driver is standing at the pickup and the server routes from it. That
 * makes the key constant for the life of the screen.
 *
 * With `retry: false` and nothing to change the key, one failed attempt left
 * that map on its dashed line **however long the API had been back**. There is
 * no reconnect event to rescue it either — the phone never lost signal, only
 * the office went away.
 *
 * The cost argument is the other half and is not relaxed: a route that
 * *succeeds* is never polled, which the last test here pins.
 */

const mockFetchTripRoute = jest.fn();

jest.mock('../api/endpoints', () => ({
  fetchTripRoute: (...args: unknown[]) => mockFetchTripRoute(...args),
}));

jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));

const ROAD = {
  polyline: 'a~l~Fjk~uOwHJy@P',
  distance_km: 6.1,
  duration_seconds: 780,
  provider: 'osrm' as const,
  is_estimate: true as const,
};

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function freshClient(): QueryClient {
  return new QueryClient({
    // Retries and intervals come from the hook, which is what is under test.
    // A default set here would mask whichever of them was missing.
    defaultOptions: { queries: { gcTime: 0 } },
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetchTripRoute.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

it('tries again once before settling for the dashed line', async () => {
  // One retry, not three. A blip deserves a second try; a route the server
  // cannot draw deserves the fallback the map is built for — and each attempt
  // is a billed request under a Directions key.
  mockFetchTripRoute.mockRejectedValue(new Error('Network request failed'));

  const client = freshClient();

  await renderHook(() => useTripRoute(42, null), { wrapper: wrapper(client) });

  await act(async () => {
    await jest.advanceTimersByTimeAsync(5_000);
  });

  expect(mockFetchTripRoute).toHaveBeenCalledTimes(2);
});

it('keeps asking after it has failed, so the road returns when the office does', async () => {
  mockFetchTripRoute.mockRejectedValue(new Error('Network request failed'));

  const client = freshClient();
  const { result } = await renderHook(() => useTripRoute(42, null), {
    wrapper: wrapper(client),
  });

  await act(async () => {
    await jest.advanceTimersByTimeAsync(5_000);
  });

  const afterFailing = mockFetchTripRoute.mock.calls.length;

  expect(result.current.status).toBe('error');

  // The office comes back a minute later. Nothing about this screen has
  // changed — same trip, same absent position, same query key — so without the
  // poll there is nothing left to ask again.
  mockFetchTripRoute.mockResolvedValue(ROAD);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(31_000);
  });

  expect(mockFetchTripRoute.mock.calls.length).toBeGreaterThan(afterFailing);
  expect(result.current.data).toEqual(ROAD);
});

it('never polls a road it already has', async () => {
  // The whole cost argument in one assertion. At roughly $5 per 1,000
  // requests, a timer over a drawn route is the spend the snapped key exists
  // to avoid — so the interval is a function that returns false unless the
  // last attempt failed.
  mockFetchTripRoute.mockResolvedValue(ROAD);

  const client = freshClient();
  const { result } = await renderHook(() => useTripRoute(42, null), {
    wrapper: wrapper(client),
  });

  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });

  expect(result.current.data).toEqual(ROAD);

  const afterSuccess = mockFetchTripRoute.mock.calls.length;

  await act(async () => {
    await jest.advanceTimersByTimeAsync(5 * 60_000);
  });

  expect(mockFetchTripRoute).toHaveBeenCalledTimes(afterSuccess);
});

it('asks nothing at all while the caller has not decided the leg', async () => {
  mockFetchTripRoute.mockResolvedValue(ROAD);

  const client = freshClient();

  await renderHook(() => useTripRoute(42, null, 'dropoff', false), {
    wrapper: wrapper(client),
  });

  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });

  expect(mockFetchTripRoute).not.toHaveBeenCalled();
});
