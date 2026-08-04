<?php

namespace Modules\Administration\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Services\SettingsService;

/**
 * The branding subset, unauthenticated (ADR-0014 §5). What it may serve
 * is decided by the catalogue's `public` flags, not by this controller —
 * adding a key here is impossible, which is the point.
 */
class PublicSettingsController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function index(): JsonResponse
    {
        return ApiResponse::success(
            ['settings' => $this->settings->publicSubset()],
            'Public settings retrieved.',
        );
    }
}
