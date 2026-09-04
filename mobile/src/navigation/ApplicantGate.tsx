import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { listMyApplicationDocuments } from '../documents/applicationDocuments';
import { ApplicationPendingScreen } from '../screens/ApplicationPendingScreen';
import { colors } from '../ui/theme';

/**
 * Decides whether a signed-in account is a driver or still an applicant
 * (ADR-0057 §5).
 *
 * ## Why this asks the server rather than reading the token
 *
 * Nothing on the account says it. Authority on this platform is the
 * `drivers.user_id` link and never the role — nine controllers resolve the
 * actor that way — so "am I a driver yet?" is a question about a row, not a
 * claim, and the honest way to ask it is to ask.
 *
 * `GET /me/application/documents` answers it in one request: **200 means
 * there is an open application, which means they are not a driver.** Adding
 * a field to the login payload would have been cheaper by one request and
 * wrong by one source of truth — a cached boolean that says "driver" while
 * the row says otherwise is exactly how somebody ends up on a home screen
 * that 404s.
 *
 * ## What it costs, and why that is the right trade
 *
 * One extra request per app start for a real driver, answering 404. Against
 * it: an approved driver otherwise pays nothing, and an applicant is spared
 * an app in which every screen fails. `staleTime: Infinity` keeps it to once
 * a session — the answer only changes when the office approves them, which
 * is a sign-out and back in.
 *
 * ## Failing towards the app
 *
 * Any error — offline, a 500, a timeout — falls through to the driver app.
 * A driver upcountry with no signal must not be shown an applicant screen
 * because a request failed; `useQuery`'s `isError` and its 404 are the same
 * shape here, and only a *successful* 200 diverts anybody.
 */
export function ApplicantGate({ children }: { children: ReactNode }) {
  const { api, user } = useAuth();

  const application = useQuery({
    // Keyed by the account, so signing in as somebody else asks again rather
    // than reusing the previous person's answer.
    queryKey: ['my-application', user?.id ?? null],
    queryFn: () => listMyApplicationDocuments(api),
    staleTime: Infinity,
    gcTime: Infinity,
    // A driver's 404 is the expected answer, not a fault. Retrying it three
    // times would delay every driver's launch to re-ask a settled question.
    retry: false,
    // Never persisted: `App.tsx` writes the read cache to AsyncStorage for a
    // day, and "which screen do I get" is a decision to re-take at launch
    // rather than restore from disk.
    networkMode: 'always',
  });

  if (application.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (application.isSuccess) {
    return <ApplicationPendingScreen />;
  }

  return <>{children}</>;
}
