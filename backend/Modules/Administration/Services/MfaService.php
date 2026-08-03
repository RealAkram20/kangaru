<?php

namespace Modules\Administration\Services;

use App\Models\AuditLog;
use App\Models\User;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Modules\Administration\Models\MfaChallenge;
use OTPHP\TOTP;

/**
 * TOTP enrolment, verification and recovery (ADR-0008).
 *
 * RFC 6238 rather than SMS or email. AGENTS.md argues against SMS in its
 * own security section — SMS pumping fraud is named as a real regional cost
 * — and that is only the cost objection: a SIM swap defeats it, and the
 * platform would be paying per message for a control meant to be always on.
 * Email is worse than it looks, because email is the channel a password
 * reset travels over, so an attacker holding the mailbox holds both
 * factors. TOTP costs nothing per use and works with no network, which
 * matters for a platform whose own risk register names upcountry
 * connectivity.
 *
 * Not Laravel Fortify: it is built around a session-authenticated Blade
 * application, registers its own routes and views, and bending it into a
 * token API means using a third of it and fighting the rest. The portion
 * actually needed is a code comparison and a QR image.
 */
class MfaService
{
    /** ADR-0008 decision 2. Long enough to fetch a phone, short enough to matter. */
    private const CHALLENGE_TTL_SECONDS = 300;

    /** ADR-0008 decision 4. */
    private const RECOVERY_CODE_COUNT = 10;

    /**
     * How many codes may remain before the holder is told to regenerate.
     * Below this a lost phone plus a mislaid sheet is an unrecoverable
     * account, and the account that could fix it is the one locked out.
     */
    public const RECOVERY_CODE_LOW_WATER_MARK = 3;

    /**
     * One period either side of now, so a code typed as the window turns
     * over is still accepted.
     *
     * Not wider. Each extra period is another 30 seconds during which a
     * shoulder-surfed code still works, and the cost of being one period
     * mean is a user retyping six digits.
     */
    private const VERIFICATION_LEEWAY_PERIODS = 1;

    /**
     * Begins enrolment: a secret, and the QR to put it in an authenticator.
     *
     * The secret is stored immediately but **unconfirmed** — `confirm()` is
     * what completes enrolment. Storing it only after verification would
     * mean holding it in the client between two requests, and confirming
     * without storing would mean the user proves a secret the server has
     * forgotten.
     *
     * Re-callable. A user who abandons enrolment half-way, or loses the
     * phone before confirming, gets a fresh secret rather than being stuck
     * with one they cannot produce codes for. Calling it on an account that
     * is already confirmed is refused — that would be a silent reset, and
     * resetting somebody's second factor is the hazard ADR-0008 puts out of
     * scope.
     *
     * @return array{secret: string, otpauth_uri: string, qr_svg: string}
     *
     * @throws MfaAlreadyEnrolledException
     */
    public function beginEnrolment(User $user): array
    {
        if ($user->hasMfaEnabled()) {
            throw new MfaAlreadyEnrolledException;
        }

        $totp = TOTP::generate();

        // The label is what the authenticator app shows in its list. An
        // account with no email would render as a blank entry the holder
        // cannot tell from any other, so it falls back to something
        // identifiable rather than being allowed through empty.
        $totp->setLabel($user->email !== '' ? $user->email : 'user-'.$user->id);

        // The issuer groups entries in the authenticator. Falling back to a
        // literal rather than trusting config: an app name blanked in an
        // env file would otherwise leave the holder with an unlabelled
        // entry and no way to tell which system it unlocks.
        $issuer = (string) config('app.name');
        $totp->setIssuer($issuer !== '' ? $issuer : 'KangaruRide');

        $user->mfa_secret = $totp->getSecret();
        $user->mfa_confirmed_at = null;
        $user->save();

        return [
            'secret' => $totp->getSecret(),
            'otpauth_uri' => $totp->getProvisioningUri(),
            'qr_svg' => $this->qrSvg($totp->getProvisioningUri()),
        ];
    }

    /**
     * Completes enrolment against a code the user read off their app, and
     * hands back the recovery codes — the only time they are ever legible.
     *
     * @return array<int, string> the plaintext codes, shown once
     *
     * @throws InvalidMfaCodeException
     */
    public function confirmEnrolment(User $user, string $code): array
    {
        if ($user->mfa_secret === null) {
            throw new InvalidMfaCodeException;
        }

        if (! $this->codeMatches($user->mfa_secret, $code)) {
            throw new InvalidMfaCodeException;
        }

        $plaintext = $this->generateRecoveryCodes($user);

        $user->mfa_confirmed_at = now();
        $user->save();

        // Audited as a security event in its own right. Who armed a second
        // factor and when is exactly what a bank's vendor questionnaire
        // asks, and `$hidden` keeps the secret itself out of the diff.
        AuditLog::record($user, 'updated');

        return $plaintext;
    }

    /**
     * Issues the claim ticket a verified password earns (decision 2).
     *
     * The plaintext id is returned and only its hash is stored, so a
     * database disclosure does not yield usable challenge ids for the
     * challenges still inside their window.
     */
    public function issueChallenge(User $user): string
    {
        $token = Str::random(64);

        MfaChallenge::create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addSeconds(self::CHALLENGE_TTL_SECONDS),
        ]);

        return $token;
    }

    /**
     * Spends a challenge against a TOTP code or a recovery code.
     *
     * The challenge is marked consumed **whether or not the code was
     * right**. A challenge that survived a wrong code would turn the
     * five-minute window into an unlimited guessing budget against a
     * six-digit space; one attempt per challenge, plus the per-account rate
     * limit on issuing them, is what bounds it.
     *
     * @throws InvalidMfaChallengeException|InvalidMfaCodeException
     */
    public function verifyChallenge(string $challengeToken, string $code): User
    {
        $challenge = MfaChallenge::query()
            ->usable()
            ->where('token_hash', hash('sha256', $challengeToken))
            ->first();

        if ($challenge === null) {
            throw new InvalidMfaChallengeException;
        }

        $challenge->forceFill(['consumed_at' => now()])->save();

        $user = $challenge->user;

        if ($user === null || ! $user->hasMfaEnabled()) {
            throw new InvalidMfaChallengeException;
        }

        if ($this->codeMatches((string) $user->mfa_secret, $code)) {
            return $user;
        }

        if ($this->consumeRecoveryCode($user, $code)) {
            return $user;
        }

        throw new InvalidMfaCodeException;
    }

    /**
     * Ten codes, hashed like passwords and returned in plaintext once.
     *
     * Hashed rather than encrypted because nothing ever needs to read one
     * back — only to check one. The encrypted cast on the column is a
     * second layer over the hashes, not the protection itself.
     *
     * @return array<int, string> plaintext, for display exactly once
     */
    public function generateRecoveryCodes(User $user): array
    {
        $plaintext = [];
        $hashed = [];

        for ($i = 0; $i < self::RECOVERY_CODE_COUNT; $i++) {
            // Grouped for transcription: these get printed and typed back
            // by somebody who has lost their phone and is not having a good
            // day. Unambiguous alphabet — no O/0 or I/1.
            $code = strtoupper(Str::password(5, symbols: false, numbers: true, letters: true))
                .'-'
                .strtoupper(Str::password(5, symbols: false, numbers: true, letters: true));

            $plaintext[] = $code;
            $hashed[] = Hash::make($code);
        }

        $user->mfa_recovery_codes = $hashed;
        $user->save();

        return $plaintext;
    }

    /** How many unused recovery codes remain. */
    public function remainingRecoveryCodes(User $user): int
    {
        return count($user->mfa_recovery_codes ?? []);
    }

    /**
     * Whether the holder should be told to generate a fresh set.
     *
     * The threshold's only reader, which is the point: ADR-0008 defined
     * `RECOVERY_CODE_LOW_WATER_MARK` and nothing consulted it, so a user
     * spent codes one at a time and learned the count by running out — with
     * a lost phone, no code left, and no administrator able to help, because
     * ADR-0008 deliberately builds no reset.
     *
     * Answered here rather than compared in a resource or a screen, so
     * "low" cannot come to mean two different numbers in two places.
     */
    public function recoveryCodesAreLow(User $user): bool
    {
        return $this->remainingRecoveryCodes($user) <= self::RECOVERY_CODE_LOW_WATER_MARK;
    }

    /**
     * Removes a second factor, against a current code (ADR-0010 decision 2).
     *
     * Whether the *role* permits this is the caller's question, not this
     * one's — the controller refuses a role that requires a factor. What
     * this owns is that removal costs a code.
     *
     * Requiring one is what stops this being a downgrade path: an attacker
     * holding a stolen token cannot strip the factor without already holding
     * the factor. A recovery code is accepted too, because somebody
     * disabling MFA after losing their phone is the exact person who needs
     * this and the exact person who cannot produce a TOTP code.
     *
     * The recovery codes go with it. Leaving them behind would mean a
     * re-enrolment silently inheriting a sheet printed against a factor that
     * no longer exists.
     *
     * @throws InvalidMfaCodeException
     */
    public function disable(User $user, string $code): void
    {
        if (! $user->hasMfaEnabled()) {
            throw new InvalidMfaCodeException;
        }

        if (! $this->codeMatches((string) $user->mfa_secret, $code) && ! $this->consumeRecoveryCode($user, $code)) {
            throw new InvalidMfaCodeException;
        }

        $user->forceFill([
            'mfa_secret' => null,
            'mfa_confirmed_at' => null,
            'mfa_recovery_codes' => null,
        ])->save();

        // Turning a second factor *off* is at least as interesting to a
        // security review as turning it on, and `confirmEnrolment` already
        // audits the other direction.
        AuditLog::record($user, 'updated');
    }

    /**
     * Spends a recovery code if it matches one still unused.
     *
     * Using one **re-arms nothing** (decision 4): it gets you in, the code
     * is struck off, and the audit log says so. It does not disable MFA,
     * and it does not issue a replacement — a recovery code that restored
     * itself would be a password.
     */
    private function consumeRecoveryCode(User $user, string $candidate): bool
    {
        $codes = $user->mfa_recovery_codes ?? [];

        foreach ($codes as $index => $hash) {
            if (! Hash::check($candidate, $hash)) {
                continue;
            }

            unset($codes[$index]);
            $user->mfa_recovery_codes = array_values($codes);
            $user->save();

            // Audited deliberately and separately: somebody signing in
            // without their authenticator is the event a security review
            // asks about, and it is invisible in an access log.
            AuditLog::record($user, 'updated');

            return true;
        }

        return false;
    }

    private function codeMatches(string $secret, string $code): bool
    {
        // Trimmed because authenticator apps display "123 456" and people
        // paste what they see. Refusing that is a support ticket, not a
        // security control.
        $normalised = preg_replace('/\s+/', '', $code) ?? $code;

        // Neither an absent secret nor an empty code can ever match, and
        // saying so here keeps the "no secret" case from reaching the TOTP
        // library at all — where an empty secret is a fatal error rather
        // than a failed comparison.
        if ($secret === '' || $normalised === '') {
            return false;
        }

        return TOTP::createFromSecret($secret)
            ->verify($normalised, null, self::VERIFICATION_LEEWAY_PERIODS);
    }

    /**
     * SVG rather than PNG: it needs no imagick or gd, scales without
     * blurring on the enrolment screen, and travels inside the JSON
     * response as text.
     */
    private function qrSvg(string $uri): string
    {
        $writer = new Writer(new ImageRenderer(new RendererStyle(256), new SvgImageBackEnd));

        return $writer->writeString($uri);
    }
}
