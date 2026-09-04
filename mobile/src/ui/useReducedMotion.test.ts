import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

/**
 * Reading the one accessibility setting the transitions honour.
 *
 * What can be wrong: reporting reduced motion to a driver who never asked
 * for it (a flicker of stillness on every cold start), or missing the driver
 * who did.
 */

const isReduced = AccessibilityInfo.isReduceMotionEnabled as jest.MockedFunction<
  typeof AccessibilityInfo.isReduceMotionEnabled
>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('reads as full motion until the platform has actually answered', async () => {
  /*
   * The platform read is asynchronous. A hook that guessed "reduced" before
   * the answer would still the first frame of every cold start for drivers
   * who never asked — so while the promise is outstanding, the answer is the
   * default. A promise that never settles is the honest way to hold it there.
   * Mutation check: seed the state `true` and this fails.
   */
  isReduced.mockReturnValue(new Promise(() => {}));

  const { result } = await renderHook(() => useReducedMotion());

  expect(result.current).toBe(false);
});

it('corrects itself once the platform answers that motion is reduced', async () => {
  isReduced.mockResolvedValue(true);

  const { result } = await renderHook(() => useReducedMotion());

  await act(async () => {
    await Promise.resolve();
  });

  expect(result.current).toBe(true);
});

it('stays on full motion for a driver who never asked for less', async () => {
  isReduced.mockResolvedValue(false);

  const { result } = await renderHook(() => useReducedMotion());

  await act(async () => {
    await Promise.resolve();
  });

  expect(result.current).toBe(false);
});
