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
use Throwable;

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
     * Proves the stored SMTP settings actually deliver (ADR-0014 phase
     * 3). Builds a one-off mailer from settings at send time — never
     * from boot-time config — and surfaces the transport's own error
     * words on failure, because "failed" without why is a support call.
     */
    public function sendTestMail(Request $request): JsonResponse
    {
        $this->authorize('update', Setting::class);

        $validated = $request->validate(['to' => ['nullable', 'email']]);

        if (! $this->settings->mailConfigured()) {
            return ApiResponse::error(
                ErrorCode::VALIDATION_FAILED,
                'Fill in and save the mail settings first: at least host and from address, with mail enabled.',
                [],
                422,
            );
        }

        $to = $validated['to'] ?? $this->settings->get('branding', 'contact_email');

        try {
            // The same mailer every real send uses (the reset codes of
            // ADR-0028 among them) — so a green test here vouches for the
            // path that matters, not for a lookalike.
            ['mailer' => $mailer, 'from_address' => $from, 'from_name' => $fromName] =
                $this->settings->smtpMailer();

            $mailer->raw(
                'This is a test email from your KangaruRide platform settings. If you are reading it, SMTP is configured correctly.',
                function ($message) use ($from, $fromName, $to) {
                    $message->to($to)
                        ->from($from, $fromName)
                        ->subject('KangaruRide test email');
                },
            );
        } catch (Throwable $e) {
            return ApiResponse::error(
                ErrorCode::MAIL_DELIVERY_FAILED,
                'The mail server refused the test: '.$e->getMessage(),
                [],
                502,
            );
        }

        return ApiResponse::success(message: "Test email sent to {$to}. Check the inbox (and spam).");
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
