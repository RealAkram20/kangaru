<?php

namespace Modules\Notifications\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\MailPreference;
use Modules\Notifications\Models\MailToggle;

/**
 * One person's own email preferences.
 *
 * ## Why this had to exist before M6 could be called done
 *
 * **Every email this platform has sent since M1 carries a footer link to
 * `/settings/notifications`**, and until this controller there was nothing
 * there. That is precisely the failure `StoreUserRequest` warned about when it
 * refused to build half an invite flow: *"a half-built invite that emails a
 * link to nowhere is worse than an honest…"*.
 *
 * A preferences link that 404s is worse than no link. It tells the reader they
 * can stop these emails and then proves they cannot.
 *
 * ## Their own, and nobody else's
 *
 * `/me/`, like every other personal route in this codebase. There is no
 * `/users/{id}/mail-preferences` and no way to supply an id, precisely so that
 * none can be. The route takes no parameter, so the account is the token.
 *
 * ## Three things can silence an email, and this screen owns exactly one
 *
 * `NotificationType::mailIsRequired()` decides what may be switched at all;
 * `MailToggle` is the platform-wide switch a system administrator owns; this
 * is the personal one. The list reports the first two so the screen can
 * explain a row it cannot offer, rather than leaving somebody to wonder why a
 * switch they set had no effect.
 */
class MailPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->actor($request);
        $off = MailPreference::query()->where('user_id', $user->id)->pluck('type');

        $silenced = $off
            ->map(fn (NotificationType|string $type) => $type instanceof NotificationType ? $type->value : $type)
            ->all();

        $rows = array_map(fn (NotificationType $type) => [
            'type' => $type->value,
            'label' => $type->label(),
            'required' => $type->mailIsRequired(),
            // False when a system administrator has switched this type off for
            // the whole platform. Reported rather than hidden: somebody
            // wondering why they stopped getting invoices deserves to see that
            // it was not their own doing.
            'available' => MailToggle::allows($type),
            'enabled' => ! in_array($type->value, $silenced, true),
        ], $this->mailableTypes());

        return ApiResponse::success($rows);
    }

    /**
     * Switches one type on or off for this person.
     *
     * One at a time and idempotent, the same shape as the platform menu:
     * sending "off" twice leaves it off rather than toggling it back on, and a
     * screen that fails halfway leaves a state somebody can read.
     */
    public function update(Request $request): JsonResponse
    {
        $user = $this->actor($request);

        $validated = $request->validate([
            'type' => ['required', 'string', Rule::in(array_map(
                fn (NotificationType $type) => $type->value,
                $this->mailableTypes(),
            ))],
            'enabled' => ['required', 'boolean'],
        ]);

        $type = NotificationType::from($validated['type']);

        // Refused rather than stored and ignored. A preference the platform
        // keeps and then overrides reads back to the user as an answer, and
        // this is the one they would most regret believing.
        if ($type->mailIsRequired() && $validated['enabled'] === false) {
            return ApiResponse::error(
                ErrorCode::VALIDATION_FAILED,
                'That email cannot be switched off. It is the only warning you would get that something '
                .'changed about how your account is reached, or the only notice of money owed.',
                ['type' => ['This email is required and cannot be turned off.']],
                422,
            );
        }

        if ($validated['enabled']) {
            MailPreference::query()->where('user_id', $user->id)->where('type', $type->value)->delete();
        } else {
            // A row means off, and absence means on. `firstOrCreate` is what
            // makes a double-tap leave one row rather than two.
            MailPreference::query()->firstOrCreate(['user_id' => $user->id, 'type' => $type->value]);
        }

        return ApiResponse::success(null, $validated['enabled'] ? 'You will get these emails.' : 'Turned off.');
    }

    /**
     * The types that actually have an email to switch.
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

    private function actor(Request $request): User
    {
        $user = $request->user();

        // `$request->user()` is `Customer|User` across the two guards, and a
        // customer has no `users` row for a preference to hang off. Narrowed
        // rather than assumed, which is the type being honest.
        abort_unless($user instanceof User, 403);

        return $user;
    }
}
