import { Alert } from '../../../components/feedback/Alert'
import { Input } from '../../../components/forms/Input'
import { Switch } from '../../../components/forms/Switch'
import { Note, Row, SectionForm } from '../kit'
import { useSectionState } from '../state'
import type { SectionProps } from '../types'

/**
 * Whether an odometer reading is believed (ADR-0035, ADR-0047).
 *
 * Both numbers were unreachable before this section existed: the threshold
 * lived in `config/tracking.php` behind an env var, and the ceiling did not
 * exist. A driver typed one digit too many and the platform priced a 90,004 km
 * journey at UGX 198,013,800 without objecting.
 *
 * The rest of `config/tracking.php` is deliberately not here. Retention,
 * partition headroom and the GPS noise floor are properties of the measuring
 * apparatus rather than business rules, and a noise floor in an admin form is
 * an invitation to break distance measurement for the whole fleet.
 */
export function TrackingSection({ settings, onSaved, section }: SectionProps) {
  const state = useSectionState({
    odometer_enabled: settings.tracking.odometer_enabled,
    trace_route_ceiling_percent: String(settings.tracking.trace_route_ceiling_percent),
    variance_threshold_percent: String(settings.tracking.variance_threshold_percent),
    odometer_max_km_per_trip: String(settings.tracking.odometer_max_km_per_trip),
    route_tolerance_percent: String(settings.tracking.route_tolerance_percent),
    corridor_floor_percent: String(settings.tracking.corridor_floor_percent),
    corridor_ceiling_percent: String(settings.tracking.corridor_ceiling_percent),
    detour_cap_percent: String(settings.tracking.detour_cap_percent),
    resolution_grace_seconds: String(settings.tracking.resolution_grace_seconds),
    held_blocks_billing: settings.tracking.held_blocks_billing,
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      payload={() => ({
        odometer_enabled: value.odometer_enabled,
        trace_route_ceiling_percent: Number(value.trace_route_ceiling_percent),
        variance_threshold_percent: Number(value.variance_threshold_percent),
        odometer_max_km_per_trip: Number(value.odometer_max_km_per_trip),
        route_tolerance_percent: Number(value.route_tolerance_percent),
        corridor_floor_percent: Number(value.corridor_floor_percent),
        corridor_ceiling_percent: Number(value.corridor_ceiling_percent),
        detour_cap_percent: Number(value.detour_cap_percent),
        resolution_grace_seconds: Number(value.resolution_grace_seconds),
        held_blocks_billing: value.held_blocks_billing,
      })}
    >
      {(errors) => (
        <>
          <Row
            label="Drivers record odometer readings"
            htmlFor="settings-odometer"
            hint="Off prices fares from the GPS trace instead."
          >
            <Switch
              id="settings-odometer"
              checked={value.odometer_enabled}
              onChange={(event) => set('odometer_enabled', event.target.checked)}
            />
          </Row>

          {/*
            **Stated where the decision is made, not in a document nobody
            opens.** PROJECT.md lists opening and closing odometer readings as
            the Bank's acceptance criterion #4 for the Phase 1 MVP, and this
            switch is platform-wide — corporate trips included. The owner chose
            that scope knowingly, having been offered a walk-in-only version;
            the honest implementation makes the consequence impossible to miss
            rather than quietly narrowing what they asked for.

            Shown only while it is about to be true, so it reads as a
            consequence of the choice rather than as permanent scolding. It is
            the one piece of prose on this page that was not cut in the rebuild
            — a warning nobody reads twice is not the same as a hint nobody
            needed once.
          */}
          {!value.odometer_enabled && (
            <Note>
              <Alert tone="warning" title="This affects your contract with the Bank">
                Opening and closing odometer readings are one of the six acceptance
                criteria the Bank signed off. With this off, no trip produces them —
                including trips for corporate clients. Trips are still measured and
                still billed, from GPS.
              </Alert>
            </Note>
          )}

          {!value.odometer_enabled && (
            <Row
              label="Allowance over the road distance"
              htmlFor="settings-trace-ceiling"
              hint="Over this, a trip is billed at the ceiling and flagged, not refused."
              error={errors.trace_route_ceiling_percent}
              required
              control={140}
            >
              <Input
                id="settings-trace-ceiling"
                type="number"
                min={0}
                max={200}
                suffix="%"
                value={value.trace_route_ceiling_percent}
                onChange={(event) => set('trace_route_ceiling_percent', event.target.value)}
              />
            </Row>
          )}

          <Row
            label="Longest single trip"
            htmlFor="settings-odometer-ceiling"
            hint="Refused outright above this. Set it above your longest real journey."
            error={errors.odometer_max_km_per_trip}
            required
            control={160}
          >
            <Input
              id="settings-odometer-ceiling"
              type="number"
              min={1}
              max={100000}
              suffix="km"
              value={value.odometer_max_km_per_trip}
              onChange={(event) => set('odometer_max_km_per_trip', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Flag a trip when the readings differ by more than"
            htmlFor="settings-variance-threshold"
            hint="Against the GPS trace. A trip with no trace is never flagged."
            error={errors.variance_threshold_percent}
            required
            control={140}
          >
            <Input
              id="settings-variance-threshold"
              type="number"
              min={1}
              max={100}
              suffix="%"
              value={value.variance_threshold_percent}
              onChange={(event) => set('variance_threshold_percent', event.target.value)}
              required
            />
          </Row>

          <Note>
            <Alert tone="info" title="This only flags — it does not stop anything">
              A flagged trip is still invoiced and still pays the driver. Reviewing
              them is a manual job today.
            </Alert>
          </Note>

          {/*
            ADR-0045 §2, merged from main on 2026-08-23: the resolver's
            corridor and the review queue's one switch. Same section as the
            odometer numbers because they answer the same question — what
            distance is believed — from the trace's side of it.
          */}
          <Row
            label="Trust a trace within"
            htmlFor="settings-route-tolerance"
            hint="Of the routed reference. Inside is grade A; further out is grade B."
            error={errors.route_tolerance_percent}
            required
            control={140}
          >
            <Input
              id="settings-route-tolerance"
              type="number"
              min={0}
              max={100}
              suffix="%"
              value={value.route_tolerance_percent}
              onChange={(event) => set('route_tolerance_percent', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Odometer corridor, floor"
            htmlFor="settings-corridor-floor"
            hint="A reading below this share of the reference is clamped and held."
            error={errors.corridor_floor_percent}
            required
            control={140}
          >
            <Input
              id="settings-corridor-floor"
              type="number"
              min={1}
              max={100}
              suffix="%"
              value={value.corridor_floor_percent}
              onChange={(event) => set('corridor_floor_percent', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Odometer corridor, ceiling"
            htmlFor="settings-corridor-ceiling"
            hint="A reading above this share of the reference is clamped and held."
            error={errors.corridor_ceiling_percent}
            required
            control={140}
          >
            <Input
              id="settings-corridor-ceiling"
              type="number"
              min={100}
              max={300}
              suffix="%"
              value={value.corridor_ceiling_percent}
              onChange={(event) => set('corridor_ceiling_percent', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Detour cap"
            htmlFor="settings-detour-cap"
            hint="Under a route-capped rate card, billed distance never exceeds the reference by more."
            error={errors.detour_cap_percent}
            required
            control={140}
          >
            <Input
              id="settings-detour-cap"
              type="number"
              min={0}
              max={100}
              suffix="%"
              value={value.detour_cap_percent}
              onChange={(event) => set('detour_cap_percent', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Wait before measuring"
            htmlFor="settings-resolution-grace"
            hint="After Trip Completed, so the last pings land first."
            error={errors.resolution_grace_seconds}
            required
            control={140}
          >
            <Input
              id="settings-resolution-grace"
              type="number"
              min={0}
              max={3600}
              suffix="s"
              value={value.resolution_grace_seconds}
              onChange={(event) => set('resolution_grace_seconds', event.target.value)}
              required
            />
          </Row>

          <Row
            label="A held trip cannot bill"
            htmlFor="settings-held-blocks"
            hint="Until finance clears it with a reason. Off records the grade and bills anyway."
          >
            <Switch
              id="settings-held-blocks"
              checked={value.held_blocks_billing}
              onChange={(event) => set('held_blocks_billing', event.target.checked)}
            />
          </Row>
        </>
      )}
    </SectionForm>
  )
}
