<?php

namespace App\Support\Access;

use App\Enums\AccessLevel;
use Throwable;

/**
 * Who the request is acting as, and therefore what it may see (ADR-0055 §2).
 *
 * Bound as a singleton in `AppServiceProvider`, set once by `IdentifyTenant`
 * after authentication, and read by the scopes on every owned model. It
 * replaces `TenantContext`'s single nullable integer with the thing that
 * integer was standing in for: a *level*, and the identifier that goes with it.
 *
 * ## Nothing here can mean "everything"
 *
 * | Level bound | Predicate |
 * |---|---|
 * | none — the default | `1 = 0` |
 * | `FLEET` | `operator_id = ?` |
 * | `CLIENT` | `tenant_id = ?` |
 * | `KANGARU` | Kangaru's own rows |
 *
 * ADR-0006 rejected "an unbound context means every tenant" because it turns
 * every forgotten `set()` from a visible nothing into a silent everything, and
 * that reasoning survives one level up unchanged. So **`KANGARU` is not the
 * absence of a binding.** It is a binding, declared from the actor's own
 * `access_level` column, and it selects Kangaru's rows rather than everyone's.
 * Head office reaches a fleet's data by acting as somebody in it (ADR-0056),
 * on the record, or not at all.
 *
 * The practical consequence is that no state of this object grants a
 * cross-fleet read. There is nothing to leak through, and nothing to forget to
 * check.
 *
 * ## The client slot is deliberately independent
 *
 * `clientId()` is not derived from the level. A client may contract several
 * fleets (ADR-0055 §6), so the two axes never collapse into one, and
 * `BindSubjectTenant` already binds a client for an actor who is not one —
 * platform staff acting on a client's booking. That case is why `TenantContext`
 * could delegate here without changing meaning.
 */
final class AccessContext
{
    private ?AccessLevel $level = null;

    private ?int $operatorId = null;

    private ?int $clientId = null;

    /**
     * Whether any level is bound at all. False is the fail-closed state and is
     * what a queued job or console command gets until it says otherwise.
     */
    public function isBound(): bool
    {
        return $this->level !== null;
    }

    public function level(): ?AccessLevel
    {
        return $this->level;
    }

    public function operatorId(): ?int
    {
        return $this->operatorId;
    }

    public function clientId(): ?int
    {
        return $this->clientId;
    }

    /** A fleet company's own person — staff or driver. */
    public function bindFleet(int $operatorId): void
    {
        $this->level = AccessLevel::FLEET;
        $this->operatorId = $operatorId;
        $this->clientId = null;
    }

    /** A corporate client's own person. */
    public function bindClient(int $clientId): void
    {
        $this->level = AccessLevel::CLIENT;
        $this->operatorId = null;
        $this->clientId = $clientId;
    }

    /**
     * Head office. Selects Kangaru's own rows — never everyone's, which is the
     * single property this whole class exists to keep.
     */
    public function bindKangaru(): void
    {
        $this->level = AccessLevel::KANGARU;
        $this->operatorId = null;
        $this->clientId = null;
    }

    public function clear(): void
    {
        $this->level = null;
        $this->operatorId = null;
        $this->clientId = null;
    }

    /**
     * Bind a client without changing the level.
     *
     * This is `BindSubjectTenant`'s move, and ADR-0006 decision 4 is the reason
     * it has to exist: a fleet dispatcher creating a trip on Centenary Bank's
     * booking is a `FLEET` actor whose *work* is a client's, and the row has to
     * land in the client's history rather than nowhere. Their level does not
     * change — they are still fleet staff — so this sets one slot and leaves
     * the rest alone.
     */
    public function bindSubjectClient(?int $clientId): void
    {
        $this->clientId = $clientId;
    }

    /**
     * Run `$callback` with this context, then put back whatever was bound
     * before — including when the callback throws.
     *
     * **The `finally` is the whole point**, and `TenantContext::for()` records
     * why at length: this is a singleton for the request's lifetime, so a
     * binding left behind by a throw is not scoped to the call that caused it.
     * The next query in the same request would read, or write, somebody else's
     * rows.
     *
     * @template TReturn
     *
     * @param  callable(): TReturn  $callback
     * @return TReturn
     *
     * @throws Throwable whatever the callback threw, after the restore
     */
    public function during(callable $mutate, callable $callback): mixed
    {
        $level = $this->level;
        $operatorId = $this->operatorId;
        $clientId = $this->clientId;

        $mutate($this);

        try {
            return $callback();
        } finally {
            $this->level = $level;
            $this->operatorId = $operatorId;
            $this->clientId = $clientId;
        }
    }
}
