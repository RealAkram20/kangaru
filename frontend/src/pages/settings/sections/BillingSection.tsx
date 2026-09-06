import { Input } from '../../../components/forms/Input'
import { Switch } from '../../../components/forms/Switch'
import { Group, Row, SectionForm } from '../kit'
import { useSectionState } from '../state'
import type { SectionProps } from '../types'

/**
 * The `billing` group (ADR-0029 §3, widened by ADR-0034, ADR-0036, ADR-0037).
 *
 * **The commission rate is never applied retroactively.** ADR-0029 §3 writes
 * the rate in force into each ledger entry's own description, so changing it
 * here moves future work only. The section's description says so once, rather
 * than every money field repeating the assurance.
 *
 * **The money fields are suffixed with the configured currency code**, not the
 * word "shillings". The stored keys are named `_minor`, and for UGX minor and
 * major units are the same thing — so the figure typed here is the figure
 * paid. That equivalence is a property of UGX, not of the platform; a fleet
 * configured in a currency with cents would need the backend to say which unit
 * it means before this label could be trusted. Not resolved here, because
 * inventing an answer in a form label is exactly the failure this project
 * cares about.
 */
export function BillingSection({ settings, onSaved, section }: SectionProps) {
  const billing = settings.billing
  const currency = settings.regional.currency
  const state = useSectionState({
    driver_commission_percent: String(billing.driver_commission_percent),
    bonus_enabled: billing.bonus_enabled,
    bonus_weekly_trip_target: String(billing.bonus_weekly_trip_target),
    bonus_weekly_amount_minor: String(billing.bonus_weekly_amount_minor),
    peak_enabled: billing.peak_enabled,
    peak_starts_at: billing.peak_starts_at,
    peak_ends_at: billing.peak_ends_at,
    peak_uplift_percent: String(billing.peak_uplift_percent),
    referral_enabled: billing.referral_enabled,
    referral_trip_target: String(billing.referral_trip_target),
    referral_reward_amount_minor: String(billing.referral_reward_amount_minor),
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      payload={() => ({
        driver_commission_percent: Number(value.driver_commission_percent),
        bonus_enabled: value.bonus_enabled,
        bonus_weekly_trip_target: Number(value.bonus_weekly_trip_target),
        bonus_weekly_amount_minor: Number(value.bonus_weekly_amount_minor),
        peak_enabled: value.peak_enabled,
        peak_starts_at: value.peak_starts_at,
        peak_ends_at: value.peak_ends_at,
        peak_uplift_percent: Number(value.peak_uplift_percent),
        referral_enabled: value.referral_enabled,
        referral_trip_target: Number(value.referral_trip_target),
        referral_reward_amount_minor: Number(value.referral_reward_amount_minor),
      })}
    >
      {(errors) => (
        <>
          <Row
            label="Commission the platform keeps"
            htmlFor="settings-commission"
            hint="From every walk-in fare and every tip."
            error={errors.driver_commission_percent}
            required
            control={140}
          >
            <Input
              id="settings-commission"
              type="number"
              min={0}
              max={100}
              suffix="%"
              value={value.driver_commission_percent}
              onChange={(event) => set('driver_commission_percent', event.target.value)}
              required
            />
          </Row>

          <Group>Weekly bonus</Group>

          <Row
            label="Award a weekly bonus"
            htmlFor="settings-bonus-enabled"
            hint="Paid after a finished week, never mid-week."
          >
            <Switch
              id="settings-bonus-enabled"
              checked={value.bonus_enabled}
              onChange={(event) => set('bonus_enabled', event.target.checked)}
            />
          </Row>

          <Row
            label="Trips needed in a week"
            htmlFor="settings-bonus-target"
            error={errors.bonus_weekly_trip_target}
            required
            control={120}
          >
            <Input
              id="settings-bonus-target"
              type="number"
              min={1}
              max={1000}
              value={value.bonus_weekly_trip_target}
              onChange={(event) => set('bonus_weekly_trip_target', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Bonus amount"
            htmlFor="settings-bonus-amount"
            hint="No commission is taken from a bonus."
            error={errors.bonus_weekly_amount_minor}
            required
            control={180}
          >
            <Input
              id="settings-bonus-amount"
              type="number"
              min={0}
              suffix={currency}
              value={value.bonus_weekly_amount_minor}
              onChange={(event) => set('bonus_weekly_amount_minor', event.target.value)}
              required
            />
          </Row>

          <Group>Peak hours</Group>

          <Row
            label="Pay more during peak hours"
            htmlFor="settings-peak-enabled"
            hint="Bills on every trip in the window, not once a week."
          >
            <Switch
              id="settings-peak-enabled"
              checked={value.peak_enabled}
              onChange={(event) => set('peak_enabled', event.target.checked)}
            />
          </Row>

          <Row
            label="Window"
            htmlFor="settings-peak-from"
            hint="Fleet timezone. May cross midnight; equal times mean no window."
            error={errors.peak_starts_at ?? errors.peak_ends_at}
            required
            control={320}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Input
                id="settings-peak-from"
                type="time"
                value={value.peak_starts_at}
                onChange={(event) => set('peak_starts_at', event.target.value)}
                required
                style={{ maxWidth: 140 }}
              />
              <span style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
                to
              </span>
              {/* Its own label, clipped: the row's visible label covers the
                  pair, and a second control with no accessible name is a
                  control a screen reader cannot tell you the purpose of. */}
              <label htmlFor="settings-peak-until" className="kr-sr-only">
                Peak ends
              </label>
              <Input
                id="settings-peak-until"
                type="time"
                value={value.peak_ends_at}
                onChange={(event) => set('peak_ends_at', event.target.value)}
                required
                style={{ maxWidth: 140 }}
              />
            </div>
          </Row>

          <Row
            label="Peak uplift"
            htmlFor="settings-peak-percent"
            hint="On the driver's share only. The passenger pays the same."
            error={errors.peak_uplift_percent}
            required
            control={140}
          >
            <Input
              id="settings-peak-percent"
              type="number"
              min={1}
              max={100}
              suffix="%"
              value={value.peak_uplift_percent}
              onChange={(event) => set('peak_uplift_percent', event.target.value)}
              required
            />
          </Row>

          <Group>Referrals</Group>

          <Row
            label="Pay drivers for referrals"
            htmlFor="settings-referral-enabled"
            hint="Each referral arrives as an application somebody must approve."
          >
            <Switch
              id="settings-referral-enabled"
              checked={value.referral_enabled}
              onChange={(event) => set('referral_enabled', event.target.checked)}
            />
          </Row>

          <Row
            label="Trips the new driver must complete"
            htmlFor="settings-referral-target"
            error={errors.referral_trip_target}
            required
            control={120}
          >
            <Input
              id="settings-referral-target"
              type="number"
              min={1}
              max={1000}
              value={value.referral_trip_target}
              onChange={(event) => set('referral_trip_target', event.target.value)}
              required
            />
          </Row>

          <Row
            label="Referral reward"
            htmlFor="settings-referral-reward"
            hint="Paid to the introducer."
            error={errors.referral_reward_amount_minor}
            required
            control={180}
          >
            <Input
              id="settings-referral-reward"
              type="number"
              min={0}
              suffix={currency}
              value={value.referral_reward_amount_minor}
              onChange={(event) => set('referral_reward_amount_minor', event.target.value)}
              required
            />
          </Row>
        </>
      )}
    </SectionForm>
  )
}
