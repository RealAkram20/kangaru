<?php

namespace Modules\Notifications\Controllers;

use App\Enums\AccessLevel;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Modules\Administration\Models\Setting;
use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\MailToggle;

/**
 * Which emails this deployment sends, for a system administrator to decide.
 *
 * ## The permission is not enough. The level is what holds this.
 *
 * `settings.manage` was the obvious gate and it was wrong, in the way
 * `OperatorPolicy` documents at length: **every Super Admin holds it,
 * including a fleet's own.** `StoreRoleRequest` refuses to let anybody grant a
 * permission they do not hold, so holding it out of the Super Admin role would
 * make it grantable by nobody.
 *
 * That matters here more than it does for the settings beside it, because of
 * an asymmetry in the tables. A fleet editing an SMTP setting writes its own
 * override beside Kangaru's default (ADR-0055 §5), so the blast radius is
 * their own fleet. **`mail_toggles` has no `operator_id`** — it is one row per
 * type for the whole platform — so a fleet Super Admin flipping a switch here
 * would silence that email for every other fleet and every client on it.
 *
 * So both are required: `settings.manage` for the permission, and
 * `access_level === kangaru` for the level. A fleet Super Admin holds the
 * permission and cannot use it, exactly as they hold `fleets.manage` and
 * cannot read the register.
 *
 * The read is held as tightly as the write, per ADR-0014 §4: the list tells
 * you which warnings this platform does not send, which is operational
 * intelligence on its own.
 *
 * ## The list is the enum, not the table
 *
 * `index()` walks `NotificationType` and reports each one's state, so a type
 * added tomorrow appears on the screen tomorrow with no migration and no
 * catalogue to update. The table only records departures from the default.
 *
 * ## Required types are listed and locked, not hidden
 *
 * Hiding them would be the easier screen and the worse one. An administrator
 * looking for "why did nobody get the password reset email" needs to find it
 * and see that it cannot be switched off; a list that omits it leaves them
 * hunting for a switch that does not exist. So each row carries `required`,
 * the screen renders those without a control, and the write path refuses one
 * outright rather than accepting it and quietly doing nothing.
 */
class MailToggleController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Setting::class);
        $this->refuseAnyoneButHeadOffice($request);

        $disabled = MailToggle::disabledTypes();

        $rows = array_map(fn (NotificationType $type) => [
            'type' => $type->value,
            'label' => $type->label(),
            'required' => $type->mailIsRequired(),
            'enabled' => ! in_array($type->value, $disabled, true),
        ], $this->mailableTypes());

        return ApiResponse::success($rows);
    }

    /**
     * Flips one switch.
     *
     * One at a time rather than a whole list, so a screen that fails halfway
     * leaves a state somebody can read: eleven switches saved and one not is
     * comprehensible, a partially applied batch is not.
     */
    public function update(Request $request): JsonResponse
    {
        $this->authorize('update', Setting::class);
        $this->refuseAnyoneButHeadOffice($request);

        $validated = $request->validate([
            'type' => ['required', 'string', Rule::in(array_map(
                fn (NotificationType $type) => $type->value,
                $this->mailableTypes(),
            ))],
            'enabled' => ['required', 'boolean'],
        ]);

        $type = NotificationType::from($validated['type']);

        // Refused rather than silently ignored. A switch the platform stores
        // and then overrides is worse than no switch: the administrator reads
        // it back as an answer.
        if ($type->mailIsRequired() && $validated['enabled'] === false) {
            return ApiResponse::error(
                \App\Enums\ErrorCode::VALIDATION_FAILED,
                'That email cannot be switched off. It is the only warning an account holder gets that '
                .'something changed about how their account is reached, or the only notice of money owed.',
                ['type' => ['This email is required and cannot be disabled.']],
                422,
            );
        }

        $validated['enabled']
            ? MailToggle::enable($type)
            : MailToggle::disable($type, $request->user());

        return ApiResponse::success(null, $validated['enabled'] ? 'Email switched on.' : 'Email switched off.');
    }

    /**
     * 403 for anybody who is not head office, permission or no permission.
     *
     * Separate from the policy rather than folded into `SettingPolicy`,
     * because that policy is shared with twelve settings groups a fleet is
     * *supposed* to be able to edit for itself. Narrowing it there would take
     * the SMTP screen away from every fleet to protect this one screen.
     */
    private function refuseAnyoneButHeadOffice(Request $request): void
    {
        if ($request->user()?->access_level === AccessLevel::KANGARU) {
            return;
        }

        // `AuthorizationException`, not `abort(403)`. The handler renders this
        // one into the standard error envelope, exactly as `$this->authorize()`
        // does; a bare abort produces a body with no `success` key and the
        // OpenAPI gate catches it, which is how this was found.
        throw new AuthorizationException;
    }

    /**
     * The types that actually have an email to switch.
     *
     * A push-only or in-app-only type on this screen would be a control that
     * does nothing, which is the same fault as a locked switch presented as an
     * open one. Read from the same configuration the channel selection uses,
     * so the screen cannot claim an email that `config/notifications.php` does
     * not send.
     *
     * @return array<int, NotificationType>
     */
    private function mailableTypes(): array
    {
        return array_values(array_filter(
            NotificationType::cases(),
            function (NotificationType $type): bool {
                $configured = config('notifications.channels.'.$type->value);

                $channels = is_array($configured)
                    ? $configured
                    : array_map(fn (NotificationChannel $c) => $c->value, $type->defaultChannels());

                return in_array(NotificationChannel::MAIL->value, $channels, true);
            },
        ));
    }
}
