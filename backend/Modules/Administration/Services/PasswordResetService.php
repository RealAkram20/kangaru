<?php

namespace Modules\Administration\Services;

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

/**
 * The emailed reset code (ADR-0028 §2).
 *
 * Everything here is shaped by one asymmetry: the person on the phone is a
 * stranger until the code proves otherwise. So `request()` confesses nothing
 * — not whether the email exists, not whether the mail sent — and `reset()`
 * fails identically for a wrong code and an unknown address. The only party
 * who learns anything is the holder of the mailbox.
 */
class PasswordResetService
{
    /** ADR-0028 §2. Long enough for a slow inbox, short enough to shoulder-surf nothing. */
    public const CODE_TTL_MINUTES = 15;

    /** A second code is not issued while the first is this fresh. */
    public const RESEND_COOLDOWN_SECONDS = 60;

    /** Wrong guesses that burn the code (see the attempts migration). */
    public const MAX_ATTEMPTS = 5;

    public function __construct(private readonly SettingsService $settings) {}

    /** The flag, and the transport it is worthless without (ADR-0028 §1). */
    public function enabled(): bool
    {
        return $this->settings->get('auth', 'password_reset_enabled') === true
            && $this->settings->mailConfigured();
    }

    /**
     * Issues and mails a code — or quietly does nothing, which the caller
     * must not be able to tell apart.
     */
    public function request(string $email): void
    {
        /** @var User|null $user */
        $user = User::query()->where('email', $email)->first();

        // An unknown address and a suspended account get the same silence:
        // either would be an oracle (ADR-0027 §5's reasoning, same door).
        if ($user === null || $user->status !== UserStatus::ACTIVE) {
            return;
        }

        $existing = DB::table('password_reset_tokens')->where('email', $email)->first();

        // The cooldown is per-email, not per-IP — the route throttle handles
        // addresses. Without this, anyone who knows a driver's email could
        // have their inbox ringing all day from rotating IPs.
        if ($existing !== null
            && now()->diffInSeconds($existing->created_at, true) < self::RESEND_COOLDOWN_SECONDS) {
            return;
        }

        $code = $this->generateCode();

        DB::table('password_reset_tokens')->updateOrInsert(
            ['email' => $email],
            ['token' => Hash::make($code), 'attempts' => 0, 'created_at' => now()],
        );

        $this->mail($user, $code);
    }

    /**
     * Proves the code and sets the password. True on success.
     *
     * Success revokes every token the account holds, exactly as the in-app
     * change does: a reset that leaves a stolen session signed in has reset
     * nothing.
     */
    public function reset(string $email, string $code, string $password): bool
    {
        $row = DB::table('password_reset_tokens')->where('email', $email)->first();

        if ($row === null || now()->diffInMinutes($row->created_at, true) >= self::CODE_TTL_MINUTES) {
            return false;
        }

        if (! Hash::check($code, $row->token)) {
            // Counted, and fatal at five: a six-digit space survives a
            // 5/min/IP throttle only until somebody brings more addresses.
            if ($row->attempts + 1 >= self::MAX_ATTEMPTS) {
                DB::table('password_reset_tokens')->where('email', $email)->delete();
            } else {
                DB::table('password_reset_tokens')->where('email', $email)->increment('attempts');
            }

            return false;
        }

        /** @var User|null $user */
        $user = User::query()->where('email', $email)->first();

        if ($user === null || $user->status !== UserStatus::ACTIVE) {
            return false;
        }

        $user->password = $password;
        $user->save();

        $user->tokens()->delete();

        DB::table('password_reset_tokens')->where('email', $email)->delete();

        return true;
    }

    /**
     * Six digits, from the CSPRNG, zero-padded so "042317" has the same
     * space as "942317".
     *
     * A method rather than an inline call so tests can pin it — the stored
     * copy is hashed, and a test that cannot know the plaintext cannot walk
     * the reset half of the flow.
     */
    public function generateCode(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    /**
     * Best-effort by design. A transport failure is logged for the operator
     * and hidden from the requester — "your mail server is down" is exactly
     * the deployment detail a stranger probing the endpoint should not get,
     * and the driver's remedy (ask again, or call the office) is the same
     * either way.
     */
    private function mail(User $user, string $code): void
    {
        try {
            ['mailer' => $mailer, 'from_address' => $from, 'from_name' => $fromName] =
                $this->settings->smtpMailer();

            $minutes = self::CODE_TTL_MINUTES;
            $appName = (string) $this->settings->get('branding', 'app_name');

            $mailer->raw(
                "Your {$appName} password reset code is: {$code}\n\n"
                ."It expires in {$minutes} minutes. If you did not ask for it, you can ignore "
                .'this email — your password has not changed.',
                function ($message) use ($user, $from, $fromName, $appName) {
                    $message->to($user->email)
                        ->from($from, $fromName)
                        ->subject("{$appName} password reset code");
                },
            );
        } catch (\Throwable $e) {
            Log::warning('password_reset.mail_failed', [
                'email' => $user->email,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
