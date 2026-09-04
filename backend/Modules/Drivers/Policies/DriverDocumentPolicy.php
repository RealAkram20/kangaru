<?php

namespace Modules\Drivers\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Drivers\Models\DriverDocument;

/**
 * Who may read and review a driver's papers (ADR-0033 §4).
 *
 * A policy rather than an inline permission check for the reason
 * `DriverSettlementRequestPolicy` records: `$this->authorize()` raises an
 * `AuthorizationException` that the handler renders as the platform's API
 * envelope, where a bare `abort(403)` produces a framework error page that the
 * contract validator rejects.
 *
 * **`drivers.manage` is the gate, and it is a compromise.** Verifying a
 * licence is a compliance act, and if a Compliance role ever separates from
 * Fleet this class is the single seam to cut — nothing else consults a
 * permission on a document.
 *
 * **A driver reaches their own documents without this policy**, through
 * `/me/documents`, which authorises on the token: there is no id in the path,
 * so there is no cross-driver read to spell. `view()` below exists for the
 * *file* endpoints, which do take an id — and it is the one ability a driver
 * holds here, over their own row only.
 */
class DriverDocumentPolicy
{
    /** The office queue, and one driver's list in the console. */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    /**
     * Reading the file itself.
     *
     * Two ways in, and the order matters: **the owner check comes first** so
     * that a driver reaches their own document without needing a staff
     * permission, and a staff member reaches anybody's with one. A driver who
     * is somehow also staff passes on the first clause, which is correct — the
     * document is still theirs.
     */
    public function view(User $user, DriverDocument $document): bool
    {
        if ($document->driver !== null && $document->driver->user_id === $user->getKey()) {
            return true;
        }

        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    /**
     * The office uploading or replacing a driver's document on their behalf
     * (ADR-0052 §5).
     *
     * Class-level, like `viewAny()`, because there is no document yet to
     * authorise against — the whole point is to create one.
     *
     * **The same `drivers.manage` gate, and no separate permission.** A clerk
     * who may already read every driver's identity document and decide whether
     * it is genuine is not meaningfully restrained by being unable to file the
     * photograph the driver just handed across the counter. Inventing a
     * permission for it would be a role nobody can describe.
     *
     * **What this does not grant is the part worth naming: an upload is never
     * a verification.** `DriverDocumentService::upload()` writes `pending` and
     * clears every review field, whoever called it, so an administrator who
     * files a document has *not* approved it — somebody still has to look and
     * `review()` below still gates that. ADR-0033 §4's "nothing is
     * auto-verified, ever" survives this addition intact, and would not have
     * survived a shortcut that filed and accepted in one act.
     */
    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    /**
     * Verifying or rejecting.
     *
     * One ability for both, because they are the same authority used two ways:
     * whoever may accept a licence may also refuse it. Splitting them would
     * describe a role that can only ever say yes.
     *
     * **Deliberately not available to the document's owner.** A driver
     * verifying their own licence is the feature inverting itself, and it is
     * worth an explicit sentence because `view()` immediately above does grant
     * them ownership rights.
     */
    public function review(User $user, DriverDocument $document): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }
}
