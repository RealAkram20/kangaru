<?php

namespace Modules\Administration\Services;

use Illuminate\Support\Facades\Http;

/**
 * Asks the provider itself whether the phone's proof is real (ADR-0028 §3).
 *
 * The server never decodes-and-trusts: Google is asked about Google's
 * token, Facebook about Facebook's, over TLS, against the credentials the
 * admin stored. The cost is one outbound HTTPS call per sign-in — which is
 * the correct price, because the alternative is local JWT verification
 * with a JWKS cache, more machinery for the same guarantee and one more
 * place for a stale key to linger.
 *
 * @phpstan-type Claims array{provider_id: string, email: string, email_verified: bool, name: string}
 */
class SocialTokenVerifier
{
    public function __construct(private readonly SettingsService $settings) {}

    /**
     * @return Claims
     *
     * @throws SocialTokenException
     */
    public function verify(string $provider, string $token): array
    {
        return $provider === 'google'
            ? $this->google($token)
            : $this->facebook($token);
    }

    /**
     * @return Claims
     */
    private function google(string $idToken): array
    {
        $response = Http::timeout(10)
            ->get('https://oauth2.googleapis.com/tokeninfo', ['id_token' => $idToken]);

        if (! $response->ok()) {
            throw new SocialTokenException('google: tokeninfo refused the token');
        }

        $claims = $response->json();

        // The audience check is the one that matters most: a valid Google
        // token minted for somebody else's app is still somebody else's
        // sign-in. The acceptable audiences are whatever the admin stored.
        $allowed = array_filter(array_map(
            'trim',
            explode(',', (string) $this->settings->get('auth', 'google_client_ids')),
        ));

        if (! in_array($claims['aud'] ?? '', $allowed, true)) {
            throw new SocialTokenException('google: audience not in configured client ids');
        }

        if (($claims['exp'] ?? 0) < time()) {
            throw new SocialTokenException('google: token expired');
        }

        if (blank($claims['sub'] ?? null) || blank($claims['email'] ?? null)) {
            throw new SocialTokenException('google: token carries no subject or email');
        }

        return [
            'provider_id' => (string) $claims['sub'],
            'email' => strtolower((string) $claims['email']),
            // Google sends this as the string "true" on tokeninfo responses.
            'email_verified' => ($claims['email_verified'] ?? '') === 'true'
                || ($claims['email_verified'] ?? false) === true,
            'name' => (string) ($claims['name'] ?? ''),
        ];
    }

    /**
     * @return Claims
     */
    private function facebook(string $accessToken): array
    {
        $appId = (string) $this->settings->get('auth', 'facebook_app_id');
        $appSecret = (string) $this->settings->secret('auth', 'facebook_app_secret');

        // debug_token proves the token is live AND was minted for *this*
        // app — the audience check, in Facebook's dialect.
        $debug = Http::timeout(10)->get('https://graph.facebook.com/debug_token', [
            'input_token' => $accessToken,
            'access_token' => "{$appId}|{$appSecret}",
        ]);

        $data = $debug->json('data');

        if (! $debug->ok() || ($data['is_valid'] ?? false) !== true) {
            throw new SocialTokenException('facebook: debug_token says invalid');
        }

        if (($data['app_id'] ?? '') !== $appId) {
            throw new SocialTokenException('facebook: token belongs to another app');
        }

        $profile = Http::timeout(10)->get('https://graph.facebook.com/v19.0/me', [
            'fields' => 'id,name,email',
            'access_token' => $accessToken,
        ]);

        if (! $profile->ok() || blank($profile->json('id'))) {
            throw new SocialTokenException('facebook: profile fetch failed');
        }

        if (blank($profile->json('email'))) {
            // A Facebook account without a confirmed email (phone-only
            // signups exist) gives the platform nothing to match or contact.
            throw new SocialTokenException('facebook: profile has no email');
        }

        return [
            'provider_id' => (string) $profile->json('id'),
            'email' => strtolower((string) $profile->json('email')),
            // Facebook only ever returns confirmed addresses on /me.
            'email_verified' => true,
            'name' => (string) $profile->json('name', ''),
        ];
    }
}
