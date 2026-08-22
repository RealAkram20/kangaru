import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { expiryCeiling, isoDate } from '../profile/presentation';

/**
 * "When does this expire?", asked once and answered once.
 *
 * ## Why this is a component and not twelve lines in each screen
 *
 * `KycVerificationScreen` and `DocumentsScreen` ask the identical question
 * about the identical documents, and both had their own copy. Both copies
 * carried the same defect, and fixing it in one place would have left the
 * other quietly broken for whichever half of the fleet used that screen.
 *
 * ## The defect, because it is not visible in the JSX
 *
 * `datetimepicker`'s Android component re-opens the native dialog whenever
 * anything in its effect's dependency list changes:
 *
 * ```js
 * const valueTimestamp = value.getTime();
 * useEffect(showOrUpdatePicker,
 *   [onChange, onValueChange, onDismiss, onNeutralButtonPress, valueTimestamp, mode]);
 * ```
 *
 * Both screens passed `value={new Date()}` and two inline arrow handlers, so
 * **all three changed identity on every render** — a new millisecond and two
 * new closures. Any re-render while the dialog was up re-opened it at today,
 * discarding wherever the driver had navigated. It was reported from a
 * handset as *"we cannot select future dates like December or next year"*:
 * you can, and then it resets before you finish.
 *
 * So the three things this component exists to hold still:
 *
 * - **`value` and the bounds** are computed once, at mount. This component is
 *   mounted only while a document is staged, so mount *is* open — the dates
 *   are fresh for each document and frozen for the life of one dialog.
 * - **The callbacks come out of a ref.** The two passed in may be new
 *   closures on every parent render, which is normal and fine; what must not
 *   change is the identity of what reaches the library.
 *
 * ## `startOnYearSelection`
 *
 * An expiry is years away, and from a calendar opening on today, December of
 * next year is sixteen swipes. Opening on the year list makes it two taps.
 * Unlike `title`, it is not gated behind Material 3, so it works on the
 * dialog these handsets actually get.
 */
export function ExpiryDatePicker({
  onPicked,
  onCancelled,
}: {
  /** The chosen day, already in the `YYYY-MM-DD` the API wants. */
  onPicked: (expiresAt: string) => void;
  onCancelled: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const limit = useMemo(() => expiryCeiling(now), [now]);

  /*
   * The latest callbacks, reachable without being *depended on*. Written in
   * an effect rather than during render because a render can be discarded,
   * and a ref written by a discarded render is a lie.
   */
  const handlers = useRef({ onPicked, onCancelled });

  useEffect(() => {
    handlers.current = { onPicked, onCancelled };
  }, [onPicked, onCancelled]);

  /*
   * `useCallback([])`, not a ref read during render — which is what a first
   * attempt did, and `react-hooks/refs` was right to refuse it. The identity
   * is fixed for the component's life; the *contents* of `handlers` are read
   * when the driver taps, by which time the effect above has caught up.
   */
  const picked = useCallback((_event: unknown, selected: Date | undefined) => {
    if (selected === undefined) {
      handlers.current.onCancelled();

      return;
    }

    handlers.current.onPicked(isoDate(selected));
  }, []);

  const cancelled = useCallback(() => handlers.current.onCancelled(), []);

  return (
    <DateTimePicker
      // A native module with no text and no accessible name of its own, so
      // there is nothing else a test can find it by — the convention
      // `TransactionsScreen` uses too.
      testID="expiry-picker"
      value={now}
      mode="date"
      startOnYearSelection
      // A document cannot expire in the past and still be worth sending; the
      // server refuses it, and a control that simply cannot ask the question
      // is better than a validation error.
      minimumDate={now}
      // The server has no upper bound. `expiryCeiling` explains why the
      // client does.
      maximumDate={limit}
      /*
        `onValueChange` + `onDismiss`, not the deprecated single `onChange`.
        Cancelling on Android fired `onChange` with `dismissed` *and the value
        unchanged*, so every call site had to hand-check `event.type` — and
        getting that wrong uploads a document against a date the driver
        rejected. The library decides which happened now.
      */
      onValueChange={picked}
      onDismiss={cancelled}
    />
  );
}
