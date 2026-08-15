import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type DriverDocumentType,
  fetchDriverDocuments,
  fetchDriverProfile,
  uploadDriverDocument,
} from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The profile screen's own facts (ADR-0033).
 *
 * `offlineFirst` like every other read in this app: React Query's default
 * pauses a query when the device reports no connection, which on a handset
 * that flickers in and out of coverage means a blank screen where the last
 * known answer would do.
 *
 * **Not polled.** A phone number, a vehicle and a join date change roughly
 * never; a timer here would spend battery re-asking a question whose answer
 * almost never moves on its own. The five-minute `staleTime` means a driver
 * who opens the tab after a change still gets it on the next visit.
 */
export function useDriverProfile() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['driver-profile'],
    queryFn: () => fetchDriverProfile(api),
    networkMode: 'offlineFirst',
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Every document type, held or not.
 *
 * Shorter `staleTime` than the profile above, and for one reason: this is the
 * screen a driver returns to precisely because they are waiting for the office
 * to answer. Serving a five-minute-old "waiting for the office" to somebody
 * refreshing to see whether it changed is the one case where the cache is
 * working against the reader.
 */
export function useDriverDocuments() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['driver-documents'],
    queryFn: () => fetchDriverDocuments(api),
    networkMode: 'offlineFirst',
    staleTime: 30_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Sending one.
 *
 * **Deliberately not through the offline outbox**, unlike every trip
 * transition this app makes. Two reasons, and the second is the stronger:
 *
 * - An eight-megabyte photograph in an AsyncStorage-backed queue is a
 *   different problem from a small JSON transition (ADR-0023's actual scope).
 * - A queued upload is worse than a refused one. The driver would walk away
 *   believing the office had their licence, and find out days later that it
 *   had been sitting on the handset — which is exactly the argument
 *   `useCreateSettlementRequest` makes about a message to a person.
 *
 * The profile is invalidated alongside the documents, because the compliance
 * summary on that screen is derived from these rows and would otherwise keep
 * saying "1 needs attention" after the driver had just fixed it.
 */
export function useUploadDocument() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { type: DriverDocumentType; uri: string; expiresAt: string | null }) =>
      uploadDriverDocument(api, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-profile'] });
    },
  });
}
