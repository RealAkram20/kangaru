<?php

namespace Modules\Administration\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Services\SettingsService;

/**
 * The Terms and Privacy notices, unauthenticated (ADR-0014 §1 catalogue,
 * `legal` group).
 *
 * Unauthenticated because of who needs it: the Driver App asks for consent to
 * both documents on its sign-up form, which is by definition the one screen
 * reached before anybody has a token. A document you must agree to before you
 * can have an account cannot be behind having an account.
 *
 * Separate from `PublicSettingsController` because of size rather than
 * secrecy. The branding subset is fetched on every landing-page load; these
 * are fetched when somebody taps a link, which is far rarer and far larger.
 */
class PublicLegalController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function index(): JsonResponse
    {
        return ApiResponse::success(
            $this->settings->legalDocuments(),
            'Legal documents retrieved.',
        );
    }
}
