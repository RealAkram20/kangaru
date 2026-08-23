<?php

namespace Modules\Administration\Controllers;

use App\Http\Controllers\Controller;
use App\Models\ImpersonationSession;
use App\Models\User;
use App\Support\Access\ImpersonationContext;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Administration\Requests\BeginImpersonationRequest;
use Modules\Administration\Services\ImpersonationService;

/**
 * Starting and stopping a support session (ADR-0056).
 *
 * Two verbs and no listing. Reading the history of who acted as whom is the
 * audit log's job — `impersonation_sessions` is the evidence, and
 * `AuditLogController` is where a client reads what was done to their account.
 * A second reader here would be a second answer to one question.
 */
class ImpersonationController extends Controller
{
    public function __construct(private readonly ImpersonationService $sessions) {}

    /**
     * Whether this request is being made by somebody borrowing the account,
     * and until when.
     *
     * The console cannot work this out for itself. While a session is live
     * `ActAsSubject` has already swapped the user, so `auth/me` answers as the
     * **subject** — a support agent's browser would render as that person with
     * nothing to say it was not really them, which is the failure the banner
     * exists to prevent.
     *
     * A route of its own rather than a field on `UserResource`, because the
     * session is a fact about the **request**, not about the user. Hanging it
     * on the user resource would also append `acting_as: null` to every nested
     * actor in the API — on every booking, trip event and audit row.
     *
     * Answers `null` for everybody who is simply themselves, which is almost
     * every request this platform serves.
     */
    public function show(): JsonResponse
    {
        $session = app(ImpersonationContext::class)->session();

        if (! $session instanceof ImpersonationSession) {
            return ApiResponse::success(null);
        }

        $subject = $session->subject;

        return ApiResponse::success([
            'subject_name' => $subject instanceof User ? $subject->name : 'somebody',
            'expires_at' => $session->expires_at->toIso8601String(),
        ]);
    }

    /**
     * Become somebody else, briefly and on the record.
     *
     * The Gate is checked before the request body is read, so an agent without
     * the permission is refused without having to name a subject — the refusal
     * should not depend on, or reveal, who they were about to become.
     */
    public function store(BeginImpersonationRequest $request): JsonResponse
    {
        /** @var User $actor */
        $actor = $request->user();

        /** @var User $subject */
        $subject = User::query()->findOrFail($request->integer('subject_id'));

        $session = $this->sessions->begin(
            $actor,
            $subject,
            (string) $request->validated('reason'),
            $request->ip(),
        );

        return ApiResponse::success(
            [
                'id' => $session->id,
                'subject_id' => $subject->id,
                'subject_name' => $subject->name,
                'expires_at' => $session->expires_at->toIso8601String(),
            ],
            'You are now acting as '.$subject->name.'. Every action is recorded against your name as well as theirs.',
            201,
        );
    }

    /**
     * Stop, and go back to being yourself.
     *
     * Idempotent: ending a session that has already ended, or that timed out
     * on its own, is a success rather than a 404. A support agent pressing
     * "stop" twice, or pressing it after the thirty minutes ran out, has got
     * what they wanted either way — and an error there would teach them the
     * button is unreliable.
     */
    public function destroy(): JsonResponse
    {
        // `$request->user()` here is the **subject**, because `ActAsSubject` has already
        // swapped it. The session is found by its own actor instead — the one
        // place in the application that has to look past the swap, and the
        // reason `ImpersonationContext` carries the session rather than just a
        // boolean.
        $session = app(ImpersonationContext::class)->session();

        if ($session instanceof ImpersonationSession) {
            $this->sessions->end($session);
        }

        return ApiResponse::success(message: 'You are yourself again.', status: 204);
    }
}
