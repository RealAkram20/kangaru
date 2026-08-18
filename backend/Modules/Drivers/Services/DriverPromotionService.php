<?php

namespace Modules\Drivers\Services;

use Carbon\CarbonImmutable;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;

/**
 * What the platform is currently offering this driver — the Promotions screen
 * (ADR-0036 §1, ADR-0037 §6).
 *
 * Three schemes, each owned by its own service, assembled here because the
 * screen reads them together. This class computes nothing of its own: the
 * bonus rule lives in `WeeklyBonusService`, the window in `PeakHoursService`
 * and the referral rule in `ReferralService`, and a fourth copy of any of them
 * here would be the one that gains a fix the others do not.
 *
 * ## Every key is nullable, and that is the design
 *
 * A scheme that is switched off returns null and the app draws nothing. It
 * does **not** return zeroes: `docs/screen-rules.md` §1 refuses a zero
 * standing in for a figure that does not exist, and a Weekly Challenge card
 * reading "0 of 40 trips" on a fleet that runs no bonus scheme is exactly that
 * — a measurement of a thing nobody is measuring. The mockup drew three cards;
 * a driver on a fleet running one scheme sees one, and that is honest rather
 * than broken.
 *
 * ## What the app is never told
 *
 * The rules. Not `peak_starts_at`, not `bonus_weekly_trip_target` as a policy
 * to apply — the app receives *resolved* values for this driver at this
 * moment, and re-pulls to learn that the office changed something. The audit
 * agent's finding 5, which this codebase has now recorded four times: a
 * threshold shipped inside a handset goes on asserting the old number on
 * devices nobody can reach.
 */
class DriverPromotionService
{
    public function __construct(
        private readonly WeeklyBonusService $bonuses,
        private readonly PeakHoursService $peak,
        private readonly ReferralService $referrals,
        private readonly SettingsService $settings,
        private readonly DriverEarningsService $earnings,
    ) {}

    /**
     * @return array{
     *     currency: string,
     *     timezone: string,
     *     weekly_challenge: array<string, mixed>|null,
     *     peak_hours: array<string, mixed>|null,
     *     referral: array<string, mixed>|null
     * }
     */
    public function forDriver(Driver $driver, ?CarbonImmutable $at = null): array
    {
        $now = $at ?? CarbonImmutable::now();

        return [
            // The fleet's currency and zone, served once at the top rather
            // than repeated inside each card. Every money figure below is in
            // this currency and every instant is rendered against this zone —
            // the app must not label a window in the handset's own zone, for
            // `DriverEarningsService`'s reason: a driver crossing a border
            // does not want their peak hours to move.
            'currency' => $this->currency(),
            'timezone' => $this->timezone(),
            'weekly_challenge' => $this->bonuses->progressFor($driver, $now),
            'peak_hours' => $this->peakHours($now),
            'referral' => $this->referral($driver),
        ];
    }

    /**
     * The peak window resolved onto today, plus what it pays.
     *
     * `uplift_percent` is served as a number rather than as a sentence because
     * the app has to render it into a localised string — "Earn 20% more" is
     * English, and PRODUCT.md's i18n-ready constraint means the server sends
     * the figure and the app owns the wording.
     *
     * @return array{starts_at: string, ends_at: string, active: bool, uplift_percent: int}|null
     */
    private function peakHours(CarbonImmutable $now): ?array
    {
        $window = $this->peak->windowOn($now);

        if ($window === null) {
            return null;
        }

        return $window + ['uplift_percent' => $this->peak->upliftPercent()];
    }

    /**
     * This driver's referral code and how their introductions are getting on.
     *
     * **The code is minted here**, on the first read of this screen, which is
     * the first moment anybody could use it. `ReferralService::codeFor()`
     * explains why that is better than stamping every driver at creation.
     *
     * `reward_amount_minor` and `trip_target` are the figures a *new* referral
     * would be created with — the current settings — and `earned_minor` is the
     * sum of what past ones actually promised. The two can legitimately
     * disagree after the office changes the reward, and the screen says
     * "earn X" about the first and "you have earned Y" about the second.
     *
     * @return array{
     *     code: string,
     *     trip_target: int,
     *     reward_amount_minor: int,
     *     introduced: int,
     *     qualified: int,
     *     earned_minor: int
     * }|null
     */
    private function referral(Driver $driver): ?array
    {
        if (! $this->referrals->enabled()) {
            return null;
        }

        $progress = $this->referrals->progressFor($driver);

        return [
            'code' => $this->referrals->codeFor($driver),
            'trip_target' => $this->referrals->tripTarget(),
            'reward_amount_minor' => $this->referrals->rewardMinor(),
        ] + $progress;
    }

    /**
     * The fleet's currency.
     *
     * `settings.regional.currency`, with the same fallback `WeeklyBonusService`
     * and `ReferralService` use — this is the platform's own money going out
     * on all three schemes, so there is no trip to read a denomination off.
     * AGENTS.md's money rules pair every amount with its ISO 4217 code, and
     * hardcoding `UGX` is the first thing that breaks in a second market.
     */
    private function currency(): string
    {
        $configured = $this->settings->get('regional', 'currency');

        return is_string($configured) && $configured !== '' ? $configured : 'UGX';
    }

    /**
     * The zone every instant above is meant to be rendered in.
     *
     * Delegated to `DriverEarningsService::timezone()` rather than read again
     * here: that method is the one place `settings.regional.timezone` is
     * resolved, and a second reader is a second thing to forget when the
     * default changes.
     */
    private function timezone(): string
    {
        return $this->earnings->timezone();
    }
}
