import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type DriverDocumentType,
  deleteDriverPhoto,
  fetchDriverDocuments,
  fetchDriverProfile,
  updateDriverProfile,
  uploadDriverDocument,
  uploadDriverPhoto,
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

/**
 * A driver correcting their own name or phone number.
 *
 * **Writes the server's answer straight into the cache** rather than only
 * invalidating. The endpoint returns the whole profile, so there is a fresher
 * copy in hand than a refetch would produce, and using it means the row stops
 * being an input the instant the save lands — on a slow connection an
 * invalidate-only would leave the old value on screen for as long as the
 * refetch took, which reads as a save that did not work.
 *
 * The invalidate still follows, because the drawer holds its own copy of the
 * name.
 */
export function useUpdateDriverProfile() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (changes: { name?: string; phone?: string }) => updateDriverProfile(api, changes),
    onSuccess: (profile) => {
      queryClient.setQueryData(['driver-profile'], profile);
      void queryClient.invalidateQueries({ queryKey: ['driver-profile'] });
    },
  });
}

/**
 * Setting or replacing the driver's own photograph (ADR-0041).
 *
 * Outside the outbox, for the reasons `useUploadDocument` gives above — and
 * the second one applies here too: a driver who has just watched their face
 * appear should not be looking at a picture that only exists on the handset.
 *
 * **Invalidates the profile *and* the drawer's copy of it.** The photograph is
 * rendered in two places by two queries, and the drawer is the one the driver
 * is most likely to check afterwards, because it is where the mockup put a
 * photo in the first place.
 */
export function useUploadDriverPhoto() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (uri: string) => uploadDriverPhoto(api, uri),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-profile'] });
    },
  });
}

/**
 * Taking it down again.
 *
 * Separate from the upload rather than an upload with a null argument: they
 * are different acts with different confirmations, and a single mutation would
 * make "remove my photo" reachable by a bug in the picker.
 */
export function useDeleteDriverPhoto() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteDriverPhoto(api),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-profile'] });
    },
  });
}
