<?php

namespace Modules\Customers\Services;

use App\Models\Customer;
use App\Models\User;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Modules\Customers\Enums\CustomerStatus;

/**
 * The customer register — finding one account among many (ADR-0018 §2).
 *
 * A repository in the sense ADR-0002 allows: the search is a non-trivial
 * query with a scored `OR` across four columns, it is read by both the
 * listing and the future activity view, and putting it in a controller
 * would mean two spellings of "how do I find this person".
 *
 * ## Cursor pagination, not pages
 *
 * AGENTS.md reserves cursors for "large or append-heavy lists". A customer
 * register is exactly that at retail scale, and a dispatcher scrolling for
 * the caller must not have rows shuffle under them because somebody
 * registered while they looked.
 */
class CustomerRegistry
{
    /**
     * Uganda's national significant number: the digits after the country
     * code, and what a local `07…` number is once its leading zero is
     * dropped. A constant rather than a literal because the day this
     * platform crosses a border, this is the line that has to change.
     */
    private const SIGNIFICANT_DIGITS = 9;

    /**
     * @param  array<string, mixed>  $filters  already validated
     * @return CursorPaginator<int, Customer>
     */
    public function paginate(array $filters, User $actor): CursorPaginator
    {
        return $this->query($filters)
            // Newest first: the account somebody is asking about is almost
            // always one that was just created, and a register ordered by
            // id ascending puts the person you want on the last page.
            ->orderByDesc('id')
            ->cursorPaginate(25)
            ->withQueryString();
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return Builder<Customer>
     */
    private function query(array $filters): Builder
    {
        return Customer::query()
            ->when(
                isset($filters['status']),
                fn (Builder $q) => $q->where('status', CustomerStatus::from($filters['status'])),
            )
            ->when(
                filled($filters['q'] ?? null),
                fn (Builder $q) => $this->search($q, (string) $filters['q']),
            );
    }

    /**
     * Name, phone or email.
     *
     * Phone is matched with the punctuation stripped from *both* sides. A
     * customer registered as `+256 700 123 456` is unfindable by somebody
     * typing what is on their screen — `0700123456` — and a dispatcher with
     * the caller waiting is not going to try four spellings. The digits are
     * the identity; the formatting is decoration.
     *
     * `LIKE '%term%'` is deliberate and deliberately unindexed. At retail
     * scale this is a few tens of thousands of rows, the query runs behind
     * one desk rather than in a hot path, and a trigram or full-text index
     * is a change to make when the plan says to, not on a guess.
     *
     * @param  Builder<Customer>  $query
     * @return Builder<Customer>
     */
    private function search(Builder $query, string $term): Builder
    {
        $like = '%'.str_replace(['%', '_'], ['\%', '\_'], trim($term)).'%';
        $digits = preg_replace('/\D+/', '', $term) ?? '';

        return $query->where(function (Builder $q) use ($like, $digits) {
            $q->where('first_name', 'like', $like)
                ->orWhere('last_name', 'like', $like)
                ->orWhere('email', 'like', $like);

            // The phone arm is added only when the caller typed something
            // numeric. An empty `$digits` would make it `LIKE '%%'`, which
            // matches every customer in the table — a search for "Ada"
            // returning the whole register reads as broken, not as "no
            // phone was typed".
            if ($digits === '') {
                return;
            }

            $normalised = "REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '')";

            // A full number is compared on its **national significant
            // digits**, not as a substring.
            //
            // This was written as `LIKE '%digits%'` first and was wrong in
            // the way that matters most: a customer stored as
            // `+256 700 123 456` is unfindable by a dispatcher typing
            // `0700123456`, because the local leading zero *replaces* the
            // country code rather than appearing inside it. The one form
            // people actually read off a phone screen was the one form that
            // did not work.
            //
            // Nine digits is Uganda's national significant number, so
            // `0700123456`, `700123456` and `+256700123456` all reduce to
            // the same `700123456`. Shorter input stays a substring search,
            // because somebody typing four digits is narrowing, not
            // identifying.
            if (strlen($digits) >= self::SIGNIFICANT_DIGITS) {
                $q->orWhereRaw(
                    // Tenant-scope-free by nature: customers belong to no
                    // tenant (ADR-0013 §1), so there is nothing to leak
                    // across. No user input reaches the fragment — the
                    // digits are bound.
                    "RIGHT({$normalised}, ?) = ?",
                    [self::SIGNIFICANT_DIGITS, substr($digits, -self::SIGNIFICANT_DIGITS)],
                );

                return;
            }

            $q->orWhereRaw("{$normalised} LIKE ?", ['%'.$digits.'%']);
        });
    }

    /**
     * Counts for the register's header, in one round trip.
     *
     * @return array{total: int, active: int, suspended: int}
     */
    public function tally(): array
    {
        /** @var object{total: int, active: int, suspended: int} $row */
        $row = DB::table('customers')
            ->selectRaw('COUNT(*) as total')
            ->selectRaw("SUM(status = 'active') as active")
            ->selectRaw("SUM(status = 'suspended') as suspended")
            ->first();

        return [
            'total' => (int) $row->total,
            'active' => (int) $row->active,
            'suspended' => (int) $row->suspended,
        ];
    }
}
