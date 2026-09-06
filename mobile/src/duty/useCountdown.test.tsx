import { act, renderHook } from '@testing-library/react-native';

import type { DispatchOffer } from '../api/types';
import { useCountdown } from './useCountdown';

/**
 * The clock reads the server's number **once**.
 *
 * The offer prop is replaced on every poll with a fresher, smaller
 * `expires_in_seconds`; subtracting the locally elapsed seconds from that
 * counted the same seconds twice and ran the ring at double speed. Found on a
 * handset ("the count down is not working right").
 */
function offer(expiresIn: number): DispatchOffer {
  return { id: 7, expires_in_seconds: expiresIn } as DispatchOffer;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('does not double-count when the poll refreshes the server figure', async () => {
  const { result, rerender } = await renderHook((props: { offer: DispatchOffer }) => useCountdown(props.offer), {
    initialProps: { offer: offer(15) },
  });

  expect(result.current).toBe(15);

  await act(async () => {
    jest.advanceTimersByTime(5_000);
  });
  expect(result.current).toBe(10);

  // The poll lands: the server now says 10. The clock already knows that.
  await rerender({ offer: offer(10) });
  expect(result.current).toBe(10);

  await act(async () => {
    jest.advanceTimersByTime(5_000);
  });
  expect(result.current).toBe(5);
});
