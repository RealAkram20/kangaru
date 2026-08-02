import { useEffect, useState } from 'react'

/**
 * The value, held back until it has stopped changing for `delay` ms.
 *
 * Search boxes moved server-side need this: without it every keystroke is
 * a request, so typing "Entebbe" fires seven, and the answers can arrive
 * out of order — "E" resolving after "Entebbe" leaves the wrong rows on
 * screen. Waiting for the typing to settle sends one.
 *
 * 250ms by default. Below about 200 the pause is not long enough to be a
 * pause and the requests come anyway; much above 400 and the list feels
 * like it is lagging behind the keyboard.
 *
 * The initial value is returned immediately rather than after a delay, so
 * a page does not open on an empty list for a quarter of a second.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (value === settled) return

    const timer = setTimeout(() => setSettled(value), delay)

    // Cleared on every change, which is what makes this a debounce rather
    // than a throttle: the timer only fires once the value stops moving.
    return () => clearTimeout(timer)
  }, [value, settled, delay])

  return settled
}
