<?php

namespace Modules\Dispatch\Console;

use Illuminate\Console\Command;
use Modules\Dispatch\Services\DispatchOfferService;

/**
 * Settles offers whose clock has run out and finds the next driver
 * (ADR-0024 §5).
 *
 * ## What this command is not
 *
 * It is **not** what makes an offer expire. That happens on the wall clock:
 * `expires_at` passes, and every read — `DispatchOffer::isLive()`,
 * `scopeLive`, the accept path — evaluates it. A driver cannot accept a
 * lapsed offer whether or not this has ever run, and a customer's screen
 * will not show one.
 *
 * What it does is write the fact down and *move the search on*, which is the
 * part that needs somebody to notice. Without it an order whose offer timed
 * out sits still until the next request happens to touch it.
 *
 * That split is deliberate and it is the lesson of
 * `KangaruNotification::viaConnections()`, which pins the in-app row to the
 * `sync` connection because a queue worker was not running and an approved
 * booking left the approver's own bell unchanged. A dispatch system whose
 * offers only expire when a scheduler is alive is one that wedges when the
 * scheduler dies — holding an order out with a driver who went home, and no
 * way to tell.
 *
 * ## Cadence
 *
 * `dispatch.offer_ttl_seconds` is 15 by default and cron's floor is a
 * minute, so scheduling this every minute would add up to 60 seconds to a
 * 15-second window. The schedule therefore runs it `everyMinute()` **and**
 * `DispatchOfferService::decline()` advances immediately — the common case,
 * a driver actually answering, does not wait for this at all. This is the
 * backstop for the driver who says nothing, and a passenger waiting out one
 * cron tick for a driver who ignored their phone is the honest cost of not
 * requiring a daemon.
 *
 * A deployment that does run a worker can schedule it far more often with
 * `->everyTenSeconds()`; nothing in the code assumes either cadence.
 */
class AdvanceDispatchOffers extends Command
{
    protected $signature = 'dispatch:advance-offers';

    protected $description = 'Settle timed-out job offers and offer each waiting ride to the next driver.';

    public function handle(DispatchOfferService $offers): int
    {
        $settled = $offers->advance();

        // Only speaks when it did something. A command scheduled every
        // minute that logs on every tick is a command whose output nobody
        // reads, which defeats the purpose of it saying anything at all.
        if ($settled > 0) {
            $this->info("Settled {$settled} timed-out offer(s) and moved each ride on.");
        }

        return self::SUCCESS;
    }
}