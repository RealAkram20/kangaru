<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Modules\Administration\Models\Setting;
use Modules\Administration\Services\SettingsService;

/**
 * Platform settings (ADR-0014). GET and PATCH are both behind
 * `settings.manage` via SettingPolicy — the read shows operational
 * levers, so it is not for every role. The unauthenticated branding
 * subset is PublicSettingsController's, not this one's.
 */
class SettingsController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewAny', Setting::class);

        return ApiResponse::success(
            ['settings' => $this->settings->all()],
            'Settings retrieved.',
        );
    }

    public function update(Request $request, string $group): JsonResponse
    {
        $this->authorize('update', Setting::class);

        $catalogue = SettingsService::catalogue()[$group] ?? null;

        if ($catalogue === null) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'The requested resource could not be found.',
                [],
                404,
            );
        }

        // Rules come from the catalogue, so the validation and the legal
        // keys can never disagree. Only the submitted keys are validated
        // and written: PATCH means "change these", not "replace the group".
        $submitted = array_intersect_key($request->all(), $catalogue);
        $rules = array_intersect_key(
            array_map(fn (array $spec) => $spec['rules'], $catalogue),
            $submitted,
        );

        $validated = Validator::make($submitted, $rules)->validate();

        $this->settings->setGroup($group, $validated);

        return ApiResponse::success(
            ['settings' => $this->settings->all()],
            'Settings saved.',
        );
    }

    /**
     * Logo / favicon upload (ADR-0014 §6). Multipart, stored on the
     * public disk, and the resulting path is written through the same
     * setGroup() as any other value — so it is audited like one.
     */
    public function uploadAsset(Request $request, string $asset): JsonResponse
    {
        $this->authorize('update', Setting::class);

        if (! in_array($asset, ['logo', 'favicon'], true)) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'The requested resource could not be found.',
                [],
                404,
            );
        }

        $validated = $request->validate([
            // 2MB logo, 512KB favicon; ico allowed only for the favicon.
            'file' => $asset === 'logo'
                ? ['required', 'file', 'mimes:png,jpg,jpeg,svg,webp', 'max:2048']
                : ['required', 'file', 'mimes:png,ico,svg', 'max:512'],
        ]);

        $path = $validated['file']->store('branding', 'public');

        $this->settings->setGroup('branding', ["{$asset}_path" => $path]);

        return ApiResponse::success(
            ['settings' => $this->settings->all()],
            'Uploaded.',
        );
    }
}
