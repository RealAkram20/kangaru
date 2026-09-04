import { NavigationContext } from '@react-navigation/native';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TRANSITION_FALLBACK_MS, useAfterTransition } from './useAfterTransition';

/**
 * When an expensive component is allowed to mount.
 *
 * Three ways to get this wrong. Deferring where there is no transition —
 * which would make every screen test, and every root screen, wait for
 * nothing. Never settling, which would leave a map blank forever on the one
 * screen whose event fired before the listener attached. And settling too
 * early, which is the stutter this hook exists to remove.
 */

type Listener = () => void;

/** A stand-in for the native stack's navigation object: only `addListener` matters here. */
function fakeNavigation() {
  const listeners = new Map<string, Listener>();
  const removed: string[] = [];

  return {
    listeners,
    removed,
    navigation: {
      addListener: (event: string, listener: Listener) => {
        listeners.set(event, listener);

        return () => {
          removed.push(event);
        };
      },
    },
  };
}

function withNavigator(navigation: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationContext.Provider value={navigation as never}>{children}</NavigationContext.Provider>
    );
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('is settled at once with no navigator around it', async () => {
  /*
   * Every screen test in this app renders with `navigation` as a prop and no
   * container, and a map inside one must draw exactly as it did before this
   * hook existed. Mutation check: seed the state `false` unconditionally and
   * this fails.
   */
  const { result } = await renderHook(() => useAfterTransition());

  expect(result.current).toBe(true);
});

it('waits for the push to end, then settles', async () => {
  const fake = fakeNavigation();

  const { result } = await renderHook(() => useAfterTransition(), {
    wrapper: withNavigator(fake.navigation),
  });

  // Mid-slide: the weight stays out of the frame.
  expect(result.current).toBe(false);
  expect(fake.listeners.has('transitionEnd')).toBe(true);

  await act(async () => {
    fake.listeners.get('transitionEnd')?.();
  });

  expect(result.current).toBe(true);
});

it('settles on the fallback when the event never comes', async () => {
  /*
   * A stack root on a cold start has no transition to end, and a component
   * mounted after a push attaches its listener too late. Neither may be left
   * blank. Mutation check: remove the timer and this fails.
   */
  const fake = fakeNavigation();

  const { result } = await renderHook(() => useAfterTransition(), {
    wrapper: withNavigator(fake.navigation),
  });

  expect(result.current).toBe(false);

  await act(async () => {
    jest.advanceTimersByTime(TRANSITION_FALLBACK_MS);
  });

  expect(result.current).toBe(true);
});

it('lets go of the listener and the timer on unmount', async () => {
  const fake = fakeNavigation();

  const { unmount } = await renderHook(() => useAfterTransition(), {
    wrapper: withNavigator(fake.navigation),
  });

  // Awaited: RTL v14's unmount is asynchronous, and the cleanup that removes
  // the listener runs inside it.
  await unmount();

  expect(fake.removed).toEqual(['transitionEnd']);
});
