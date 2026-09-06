import { useQuery } from '@tanstack/react-query';

import { fetchAuthMethods, type AuthMethods } from '../api/endpoints';
import { useAuth } from './AuthProvider';

/**
 * Everything off. This is what renders when the server has never been
 * reached — a fresh install in a dead zone — and it is the correct shape
 * for that moment: email sign-in and the application form work offline-ish
 * and are always shown; the methods the owner can switch off stay off
 * until the server has actually said otherwise (ADR-0028 §4).
 */
const FAIL_CLOSED: AuthMethods = {
  password_reset_enabled: false,
  google_enabled: false,
  facebook_enabled: false,
  google_client_ids: null,
  facebook_app_id: null,
};

/**
 * Which ways in the owner has switched on.
 *
 * Cached by the persisted query client like everything else, so the worst
 * case on a bad connection is this morning's answer rather than nothing —
 * and a button the owner killed disappears at the next successful fetch,
 * no release involved.
 */
export function useAuthMethods(): AuthMethods {
  const { api } = useAuth();

  const { data } = useQuery({
    queryKey: ['auth-methods'],
    queryFn: () => fetchAuthMethods(api),
    staleTime: 5 * 60 * 1000,
  });

  return data ?? FAIL_CLOSED;
}