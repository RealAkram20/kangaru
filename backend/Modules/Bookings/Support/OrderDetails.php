<?php

namespace Modules\Bookings\Support;

use Modules\Bookings\Models\OrderRequest;

/**
 * The one place `order_requests.details` is read.
 *
 * ## Why this is a class and not a private method
 *
 * It was a private method on `DispatchOfferResource`, and it stopped being
 * able to stay there the moment a second resource needed the same fact: the
 * driver app shows the payment method on the offer card *and* again on the
 * trip in progress, because a driver who accepted an hour ago has forgotten
 * whether this one is cash.
 *
 * Copying the helper into `TripResource` was the obvious move and is the
 * failure this whole shape exists to prevent. `docs/screen-rules.md` §2 says
 * it in as many words about this exact column: *"a policy spread across two
 * resources is a policy that gets applied to one and a half of them"*, and
 * `details` is the column where that costs the most. It carries
 * `sender_phone` and `recipient_phone` alongside the harmless keys, so a
 * resource that emits it wholesale leaks two personal numbers and **looks
 * entirely innocent in review**, because the field is called `details`.
 *
 * With one reader, the complete set of keys that can ever escape into an API
 * payload is the set of constants passed to `allowed()` — greppable in a
 * single search, which is the only property that makes an allow-list worth
 * having.
 *
 * ## Values are cast, not trusted
 *
 * `details` is a JSON column filled by `POST /public/order-requests`, which is
 * unauthenticated (ADR-0012 §3). A number where a string belongs would
 * otherwise reach a client typed as a string, and a nested array would reach
 * it as an object nobody declared. Anything not scalar becomes null.
 */
class OrderDetails
{
    /**
     * The keys of `details` a driver may see about a parcel.
     *
     * Both are decision inputs that identify nobody: how big the thing is and
     * what kind of thing it is. Neither says who sent it.
     *
     * @var list<string>
     */
    public const PACKAGE_FIELDS = ['item_type', 'package_size'];

    /**
     * The keys of `details` a driver may see about settlement.
     *
     * The same test: a driver carrying no float declines a cash job, and on a
     * parcel the person ordering is often not the person paying — which is
     * why `payer` travels with the method rather than being assumed to be
     * whoever placed the order.
     *
     * Both are optional on the public order form, so both are null far more
     * often than not, and null must render as an em dash rather than as a
     * guess. **`cash` is not a safe default**: a driver who arrives expecting
     * notes and is offered a mobile-money transfer they have no wallet for
     * has been told something the platform never knew.
     *
     * @var list<string>
     */
    public const PAYMENT_FIELDS = ['payment_method', 'payer'];

    /**
     * The allow-listed subset, with every requested key present.
     *
     * Missing keys come back as null rather than being absent, so a client
     * reads one shape whatever the order happened to carry.
     *
     * @param  list<string>  $fields
     * @return array<string, string|null>
     */
    public static function allowed(?OrderRequest $order, array $fields): array
    {
        $details = $order === null ? [] : ($order->details ?? []);

        $allowed = [];

        foreach ($fields as $field) {
            $value = $details[$field] ?? null;

            $allowed[$field] = is_scalar($value) ? (string) $value : null;
        }

        return $allowed;
    }
}
