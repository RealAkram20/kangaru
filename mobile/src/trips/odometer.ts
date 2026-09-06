/**
 * The two rules the server will apply to an odometer reading, applied here
 * first.
 *
 * `odometer_end` must be **≥ `odometer_start`** and must not put the journey
 * beyond the operator's ceiling, or the server 422s. Both are caught here so
 * the driver hears about it while they are still looking at the dashboard,
 * rather than as a parked queue item an hour later — no screen *sends* a
 * reading, it queues one (ADR-0023), so the server's answer is genuinely that
 * far away.
 *
 * **`ceiling` is served on the trip, never hardcoded** (ADR-0035). The office
 * can change it in the console, and a handset holding its own copy would go on
 * enforcing the old number on devices nobody can reach — the exact defect this
 * codebase records under the audit agent's finding 5. It arrives cached with
 * the trip, so it is present in a dead zone too, which is where readings get
 * typed.
 *
 * A trip fetched before the field existed has no ceiling, and that is treated
 * as "no local opinion" rather than as zero: the server still enforces it, and
 * refusing a legitimate reading because the payload is old would be worse than
 * letting the 422 arrive late.
 *
 * Its own module because two screens now capture a reading — the closing one
 * on `OdometerScreen`, the opening one at the kerb on
 * `WaitingForPassengerScreen` — and AGENTS.md's rule is that a rule that
 * appears twice becomes shared. The alternative was a copy of the ceiling
 * check that could drift from the first.
 */
export function validateOdometerReading(
  reading: string,
  opening: number | null,
  ceiling: number | null,
): string | undefined {
  if (reading === '') {
    return 'Enter the reading.';
  }

  const value = Number.parseInt(reading, 10);

  if (Number.isNaN(value)) {
    return 'Enter the reading in whole kilometres.';
  }

  if (opening !== null && value < opening) {
    return `This cannot be less than the opening reading of ${opening.toLocaleString()} km.`;
  }

  if (opening !== null && ceiling !== null && value - opening > ceiling) {
    const travelled = value - opening;

    // Names the figure and the limit, like the server's own message: "too
    // long" leaves a driver guessing which digit to change.
    return `That makes this trip ${travelled.toLocaleString()} km, over the ${ceiling.toLocaleString()} km limit for one journey. Check the reading.`;
  }

  return undefined;
}

/** Whole kilometres only: strips anything a dashboard would not show. */
export function digitsOnly(text: string): string {
  return text.replace(/[^0-9]/g, '');
}
