<?php

namespace Modules\Fleet\Enums;

/**
 * How an attempt to complete a fleet handover ended.
 *
 * ## Why this is not a boolean
 *
 * It was one, and the boolean told a lie that reached a real person. `accept()`
 * returned `false` for two unrelated reasons — the link had lapsed, *or* the
 * address had acquired an account since the invitation was sent — and the
 * controller reported both as **"That invitation has expired. Links last 7
 * days."**
 *
 * On 25 August a fleet's incoming owner was invited at 21:22 on the 24th, filed
 * a driver application at 01:44 on the 25th — which mints an account at
 * submission time (ADR-0055, amendment) — and was then told her four-hour-old
 * link had expired. It had not. Nothing in the platform could have told her
 * what actually happened, and head office withdrew and re-sent into the same
 * wall from the other side.
 *
 * Three outcomes, three sentences, because they send the reader to three
 * different places: wait for a new link, sign in, or use another address.
 */
enum TransferOutcome: string
{
    /** The fleet changed hands. */
    case ACCEPTED = 'accepted';

    /** The link had expired or had already been used between the two requests. */
    case LAPSED = 'lapsed';

    /**
     * The address belongs to an account this handover may not touch — another
     * fleet's, a client's, or head office's.
     *
     * An account that is *free to move* is promoted rather than refused
     * (`OwnershipTransferService::mayTakeOver`), so this is the genuine
     * cross-organisation case and nothing else. Moving a person between
     * organisations is the write ADR-0055 §6 and ADR-0065 both refuse.
     */
    case ADDRESS_ELSEWHERE = 'address_elsewhere';
}
