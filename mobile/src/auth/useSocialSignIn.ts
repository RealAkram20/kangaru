import * as Facebook from 'expo-auth-session/providers/facebook';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';

import { socialSignIn } from '../api/endpoints';
import { isApiError } from '../api/errors';
import { useAuth } from './AuthProvider';
import { useAuthMethods } from './authMethods';

// Closes the auth popup's browser tab when the flow completes — without
// this, Android can leave the tab open behind the app.
WebBrowser.maybeCompleteAuthSession();

/**
 * "Continue with Google / Facebook", app side (ADR-0028 §3-4).
 *
 * The native flow yields a proof; the server decides everything else. Three
 * outcomes reach the caller: a session (adopted silently — the navigator
 * reacts to `user` appearing), an instruction to apply (the verified name
 * and email, bound for the application form), or a sentence to show.
 *
 * The client ids come from the same public settings that decide whether the
 * buttons render at all — the owner pastes them into the console once, and
 * no release ships identifiers.
 */
export function useSocialSignIn({
  onApply,
  onNotice,
}: {
  /** No account: take these to the application form (ADR-0027). */
  onApply: (prefill: { name: string; email: string }) => void;
  onNotice: (message: string) => void;
}) {
  const { api, adoptSession } = useAuth();
  const methods = useAuthMethods();
  const [busyProvider, setBusyProvider] = useState<'google' | 'facebook' | null>(null);

  // First id in the list is the web client id — the one Expo's proxy flow
  // signs for. The server accepts any configured id, so ordering is a
  // convention, not a trap.
  const googleWebClientId =
    methods.google_client_ids?.split(',')[0]?.trim() ?? undefined;

  // The hooks must mount unconditionally (they are hooks); 'unset' is a
  // placeholder that can never reach a provider, because the start functions
  // below refuse to prompt until a real id is configured.
  const [googleRequest, , promptGoogle] = Google.useIdTokenAuthRequest(
    googleWebClientId !== undefined ? { clientId: googleWebClientId } : { clientId: 'unset' },
  );

  const [facebookRequest, , promptFacebook] = Facebook.useAuthRequest(
    methods.facebook_app_id !== null && methods.facebook_app_id !== ''
      ? { clientId: methods.facebook_app_id }
      : { clientId: 'unset' },
  );

  const exchange = async (provider: 'google' | 'facebook', token: string) => {
    setBusyProvider(provider);

    try {
      const result = await socialSignIn(api, { provider, token });

      if (result.status === 'signed_in') {
        await adoptSession(result.user, result.token);

        return;
      }

      onApply({ name: result.name, email: result.email });
    } catch (error) {
      // The stable codes each have an honest sentence; the server's own
      // message covers the rest. Branching on code, never message text.
      onNotice(
        isApiError(error)
          ? error.message
          : 'No connection. Signing in needs one — try again when you have signal.',
      );
    } finally {
      setBusyProvider(null);
    }
  };

  return {
    /** Whether each button should render at all (ADR-0028 §4: absent, not greyed). */
    googleAvailable: methods.google_enabled && googleWebClientId !== undefined,
    facebookAvailable:
      methods.facebook_enabled
      && methods.facebook_app_id !== null
      && methods.facebook_app_id !== '',
    resetAvailable: methods.password_reset_enabled,
    busyProvider,
    // Handler-style rather than response-effects: promptAsync resolves with
    // the outcome, so the whole flow reads top to bottom in the gesture that
    // started it — and a dismissed popup simply resolves to nothing.
    startGoogle: async () => {
      if (googleRequest === null) {
        return;
      }

      const result = await promptGoogle();

      if (result.type === 'success' && result.params.id_token !== undefined) {
        await exchange('google', result.params.id_token);
      }
    },
    startFacebook: async () => {
      if (facebookRequest === null) {
        return;
      }

      const result = await promptFacebook();

      if (result.type === 'success' && result.authentication?.accessToken) {
        await exchange('facebook', result.authentication.accessToken);
      }
    },
  };
}