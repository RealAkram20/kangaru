<?php

namespace Modules\Fleet\Console;

use App\Enums\Permission;
use App\Models\Operator;
use Illuminate\Console\Command;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\OfficeRecipient;
use Modules\Notifications\Notifications\OfficeEventNotification;

/**
 * Tells head office when a fleet has nobody who can sign in.
 *
 * ## The gap this closes, open since K4
 *
 * `docs/agent-worklog.md` has carried it in "what is deliberately not built"
 * for weeks, in these words:
 *
 * > **`fleets_without_an_account` is a number on a dashboard, not an alert.**
 * > If ADR-0059 §5's invariant breaks, somebody has to be looking.
 *
 * This is the somebody. The dashboard tile stays, because a number somebody
 * can go and check is worth having; what it could not do is speak first.
 *
 * ## Why it matters more than it sounds
 *
 * ADR-0059 §5 and `OperatorService::onboard()` both argue it: ADR-0056 assumes
 * **a person's identity**. There is no "act as Shanitah", only "act as
 * Shanitah's fleet owner". A fleet with no accounts is therefore permanently
 * unreachable to the people whose job is to support it, **and it fails at the
 * worst possible moment**, because "the last administrator left" and "we need
 * support" are correlated events.
 *
 * `OperatorService` creates the owner in the same transaction as the fleet, so
 * this should never fire. That is precisely why it is worth running: a count
 * that is always nought is a cheap check, and the day it is not nought is the
 * day somebody needs to know without being told to look.
 *
 * ## Repeats, deliberately
 *
 * There is no "already alerted" flag. This is a broken invariant rather than a
 * queue item: it does not get worked through, it gets fixed, and until it is
 * fixed the platform has a fleet nobody can help. A daily reminder is the
 * correct amount of nagging for that, and the absence of a flag means the
 * alert cannot be silenced by a row somebody wrote once.
 */
class AlertOnFleetsWithoutAccounts extends Command
{
    protected $signature = 'fleets:alert-without-accounts';

    protected $description = 'Tell head office about any fleet that has nobody who can sign in (ADR-0059 §5)';

    public function handle(OfficeRecipient $recipients): int
    {
        $orphans = Operator::query()->whereDoesntHave('users')->get();

        if ($orphans->isEmpty()) {
            $this->info('Every fleet has at least one account.');

            return self::SUCCESS;
        }

        // `fleets.view` rather than `fleets.manage`: the person who needs to
        // know is anybody who reads the register, and narrowing to whoever can
        // edit it would mean an operations manager watching the platform is
        // not told that part of it is unsupportable.
        $staff = $recipients->headOffice(Permission::FLEETS_VIEW);

        foreach ($orphans as $operator) {
            foreach ($staff as $person) {
                $person->notify(new OfficeEventNotification(
                    NotificationType::PLATFORM_FLEET_HAS_NO_ACCOUNT,
                    facts: [__('mail.office.fact_fleet') => (string) $operator->name],
                    url: '/fleets/'.$operator->getKey(),
                    replacements: ['fleet' => (string) $operator->name],
                ));
            }
        }

        $this->warn(sprintf(
            '%d fleet(s) have no account. ADR-0059 §5 says this cannot happen; it has.',
            $orphans->count(),
        ));

        return self::SUCCESS;
    }
}
