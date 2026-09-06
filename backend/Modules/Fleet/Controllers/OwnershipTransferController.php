<?php

namespace Modules\Fleet\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\Operator;
use App\Models\User;
use App\Support\Api\ApiResponse;
use App\Support\Auth\PasswordPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Fleet\Enums\TransferOutcome;
use Modules\Fleet\Models\OwnershipTransfer;
use Modules\Fleet\Requests\ProposeOwnerRequest;
use Modules\Fleet\Resources\OperatorResource;
use Modules\Fleet\Services\OwnershipTransferService;

/**
 * A fleet changing hands (owner's decision, 24 August).
 *
 * Two halves, like the invitation it is modeled on:
 *
 * - **Head office's** — propose a new owner, or withdraw the proposal.
 *   Kangaru-level only, through `OperatorPolicy::update`, because naming who
 *   owns a fleet is the register's most consequential write.
 * - **The public's** — the accept page. Unauthenticated of necessity: the
 *   reader's whole situation is that they have no account yet. The
 *   48-character token is the only credential, and the three failures get
 *   three answers for `InvitationController`'s reasons — they send the
 *   reader to three different places.
 */
class OwnershipTransferController extends Controller
{
    public function __construct(private readonly OwnershipTransferService $transfers) {}

    public function propose(ProposeOwnerRequest $request, Operator $operator): JsonResponse
    {
        $this->authorize('update', $operator);

        $actor = $request->user();

        $this->transfers->propose(
            $operator,
            (string) $request->validated('name'),
            (string) $request->validated('email'),
            $actor instanceof User ? $actor : null,
        );

        $operator->load(['plan', 'pendingOwnershipTransfer'])
            ->loadCount(['users', 'drivers', 'vehicles', 'contracts as clients_count']);

        return ApiResponse::success(
            new OperatorResource($operator),
            'Invitation sent. Nothing changes until the new owner sets their password.',
        );
    }

    public function withdraw(Request $request, Operator $operator): JsonResponse
    {
        $this->authorize('update', $operator);

        $this->transfers->withdraw($operator);

        $operator->load(['plan', 'pendingOwnershipTransfer'])
            ->loadCount(['users', 'drivers', 'vehicles', 'contracts as clients_count']);

        return ApiResponse::success(new OperatorResource($operator), 'Transfer withdrawn.');
    }

    /**
     * What the accept page shows before anybody types anything: whose fleet,
     * whose name, which address. All three belong to the holder of the
     * token, and the page needs them to say "you are taking over this fleet"
     * rather than asking somebody to trust a bare password form.
     */
    public function show(string $token): JsonResponse
    {
        $transfer = $this->transfers->find($token);

        if ($transfer === null || $transfer->operator === null) {
            return $this->unknown();
        }

        if ($transfer->accepted_at !== null) {
            return $this->alreadyAccepted();
        }

        if ($transfer->expires_at->isPast()) {
            return $this->expired();
        }

        return ApiResponse::success([
            'name' => $transfer->name,
            'email' => $transfer->email,
            'company' => (string) $transfer->operator->name,
            'expires_at' => $transfer->expires_at->toIso8601String(),
        ]);
    }

    /**
     * The handover itself. Answers success rather than a session, for the
     * invitation's reasons: the reader signs in with the password they just
     * chose, while they are still at the keyboard to fix a typo.
     */
    public function accept(Request $request, string $token): JsonResponse
    {
        $validated = $request->validate([
            // The reset's floor, which is the invitation's floor: a handover
            // that accepted a weaker password would be the weakest door into
            // an account that owns a fleet.
            'password' => ['required', 'string', 'confirmed', PasswordPolicy::rule()],
        ]);

        $transfer = $this->transfers->find($token);

        if ($transfer === null || $transfer->operator === null) {
            return $this->unknown();
        }

        if ($transfer->accepted_at !== null) {
            return $this->alreadyAccepted();
        }

        // Three outcomes, three sentences. This was one boolean and one
        // sentence — "that invitation has expired" — which on 25 August told
        // an incoming fleet owner her four-hour-old link had lapsed when the
        // truth was that she had filed a driver application overnight and
        // acquired an account. Nothing in the platform could have told her,
        // and head office withdrew and re-sent into the same wall.
        return match ($this->transfers->accept($transfer, $validated['password'])) {
            TransferOutcome::ACCEPTED => ApiResponse::success(null, 'Your password is set. Sign in with it.'),
            TransferOutcome::LAPSED => $this->expired(),
            TransferOutcome::ADDRESS_ELSEWHERE => $this->addressElsewhere(),
        };
    }

    private function unknown(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_FOUND,
            'That link is not valid. Check you copied the whole link, or ask for a new one.',
            [],
            404,
        );
    }

    private function alreadyAccepted(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::INVITATION_ALREADY_USED,
            'This invitation has already been used. Sign in with the password you chose.',
            [],
            409,
        );
    }

    /**
     * The address belongs to an account at another organisation.
     *
     * Distinct from expiry because the reader's next move is different: no new
     * link will help, and the person who can act is head office with a
     * different address. Named without saying *whose* account it is — the
     * reader is not signed in, and "this address is a client's staff member"
     * is a fact about somebody else.
     */
    private function addressElsewhere(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::OWNER_ADDRESS_IN_USE,
            'That address already belongs to an account elsewhere on Kangaru, so it cannot take over this fleet. '
            .'Ask the person who arranged the handover to use another address.',
            [],
            409,
        );
    }

    private function expired(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::INVITATION_EXPIRED,
            'That invitation has expired. Ask the person who arranged the handover to send a new one. Links last '
            .OwnershipTransfer::TTL_DAYS.' days.',
            [],
            410,
        );
    }
}
