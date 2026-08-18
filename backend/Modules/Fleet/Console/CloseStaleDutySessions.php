<?php

namespace Modules\Fleet\Console;

use Illuminate\Console\Command;
use Modules\Fleet\Services\DutySessionService;

/**
 * Closes shifts the platform has stopped hearing from (ADR-0038).
 *
 * **This is not what makes a driver undispatchable** — `DriverPresenceStore
 * ::dispatchable()` evaluates the same TTL on every read, so a driver whose
 * phone went quiet stops being offered work whether or not this has ever run.
 * What this does is write down when they stopped, so their online hours are a
 * measurement rather than an assumption.
 *
 * That is why a missed run degrades the figure instead of breaking anything:
 * an unclosed session is simply still open, and the next run closes it at the
 * same last heartbeat it would have used an hour earlier. The figure is
 * identical; only its timeliness moves.
 *
 * It also *refreshes* the sessions of drivers who are mid-trip rather than
 * closing them — see `DutySessionService::sweep()`, where that exception is
 * argued. The command is the tick; the service is the rule.
 */
class CloseStaleDutySessions extends Command
{
    protected $signature = 'duty:close-stale
                            {--ttl= : Seconds of silence before a shift is closed. Defaults to dispatch.presence_ttl_seconds.}';

    protected $description = 'Ends duty sessions with no recent heartbeat, at their last heartbeat (ADR-0038).';

    public function handle(DutySessionService $sessions): int
    {
        $option = $this->option('ttl');
        $ttl = is_string($option) && $option !== '' ? (int) $option : null;

        if ($ttl !== null && $ttl < 1) {
            $this->error('--ttl must be a positive number of seconds.');

            return self::FAILURE;
        }

        $result = $sessions->sweep(null, $ttl);

        $this->info(sprintf(
            '%d shift(s) closed, %d refreshed while on a trip.',
            $result['closed'],
            $result['refreshed'],
        ));

        return self::SUCCESS;
    }
}
