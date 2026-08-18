<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\DriverPayoutAccount;

/**
 * A payout destination **as its owner is allowed to see it** (ADR-0042 §4).
 *
 * The account number is masked to its last four characters and the whole number
 * is never in this payload. A driver confirming "yes, that is my account" needs
 * the tail; they do not need the platform to echo a full account number back to
 * a handset that may be shared, stolen, or read over a shoulder at a stage.
 *
 * **The office has a different resource** — `OfficePayoutAccountResource` —
 * because a clerk cannot wire money to a mask. Two readers, two resources, and
 * the difference is the point rather than duplication: one file cannot decide
 * to reveal the number "just for this case" without the diff saying so.
 *
 * Fields are allow-listed and the model is never spread.
 * `docs/screen-rules.md` §2, and here the object being spread would carry a
 * decrypted bank account.
 *
 * @mixin DriverPayoutAccount
 */
class DriverPayoutAccountResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'kind' => $this->kind->value,
            'kind_label' => $this->kind->label(),
            // Served rather than spelled on the handset. The two kinds ask for
            // different words — nobody calls Stanbic a provider, and nobody
            // calls MTN a bank — and a second copy of that mapping in a mobile
            // bundle is a second place for it to be wrong.
            'institution_label' => $this->kind->institutionLabel(),
            'number_label' => $this->kind->numberLabel(),
            'institution' => $this->institution,
            'account_holder_masked' => self::maskHolder($this->account_holder),
            'account_number_masked' => $this->maskedNumber(),
            'last_four' => $this->last_four,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    /**
     * An account holder's name, shortened to its initials and last name.
     *
     * Masked for the same reason the number is: the pair *name plus account
     * number* is what makes either one useful to somebody who should not have
     * it, and returning the whole name beside four digits gives back most of
     * what the mask was protecting.
     *
     * "John Kamau" becomes "J. Kamau" — enough for its owner to recognise, and
     * the surname alone is not a credential.
     */
    public static function maskHolder(string $holder): string
    {
        $parts = preg_split('/\s+/', trim($holder)) ?: [];
        $parts = array_values(array_filter($parts, static fn (string $p): bool => $p !== ''));

        if (count($parts) < 2) {
            return $holder;
        }

        $last = array_pop($parts);
        $initials = implode(' ', array_map(
            static fn (string $p): string => mb_strtoupper(mb_substr($p, 0, 1)).'.',
            $parts,
        ));

        return $initials.' '.$last;
    }
}
