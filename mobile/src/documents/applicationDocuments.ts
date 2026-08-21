import type { ApiClient } from '../api/client';
import type { DriverDocumentSlot, DriverDocumentType } from '../api/endpoints';
import { formFile } from '../api/formFile';

/**
 * The applicant's three verbs, carried by a claim ticket (ADR-0048 §4).
 *
 * Separate from `api/endpoints.ts` on purpose. Everything in that module is
 * reached with a bearer token by somebody the platform has decided about;
 * these three are reached by a stranger holding a 64-character secret that
 * resolves to one `driver_applications` row and nothing else. Keeping them
 * apart makes the difference impossible to miss in review — the same reason
 * the server keeps `Routes/public.php` in its own file.
 *
 * ## Three things this deliberately cannot do
 *
 * 1. **It cannot read a file back.** `list` returns metadata only; the server
 *    sends `file_url: null` for an application-owned row. A stolen ticket must
 *    not become a way to *read* somebody's national ID, only to overwrite it,
 *    which is noisy and gains a thief nothing.
 * 2. **It cannot ask about any other application.** There is no id in any of
 *    these paths. The row is whichever one the ticket resolves to, so a caller
 *    cannot reach somebody else's papers even by accident.
 * 3. **It cannot learn whether a ticket is spent.** Unknown, expired and
 *    already-decided all answer 404 (ADR-0027 §5, on oracles). Treat every
 *    404 from here as `TICKET_SPENT`, never as "try again".
 *
 * ## Why the header and never the query string
 *
 * A GET and a DELETE have no body worth speaking of, and a query string is the
 * one place this must not go: query strings are written to access logs, proxy
 * logs and analytics as a matter of course, and this one is a live credential
 * for somebody's identity documents. The server accepts either the body field
 * or `X-Upload-Token`; this module always sends the header, so there is one
 * answer rather than two.
 */

const TOKEN_HEADER = 'X-Upload-Token';

/**
 * The 24 hours in ADR-0048 §4 have run out, or the office has already decided.
 *
 * Its own type because the two screens that catch it say different things, and
 * neither of them should be branching on an HTTP status. There is no recovery
 * path and no retry: the applicant sends their papers after approval, from the
 * profile screen, like every other driver.
 */
export class UploadTicketSpentError extends Error {
  constructor() {
    super('This upload link has expired.');
    this.name = 'UploadTicketSpentError';
  }
}

function isSpent(error: unknown): boolean {
  // Structural rather than `instanceof ApiError`: the shape is what matters
  // and this module should not care which of the client's error classes the
  // 404 arrived in.
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: number }).status === 404
    : false;
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isSpent(error)) {
      throw new UploadTicketSpentError();
    }

    throw error;
  }
}

/** The six slots and what this applicant has sent so far. Metadata only. */
export async function listApplicationDocuments(
  api: ApiClient,
  token: string,
): Promise<DriverDocumentSlot[]> {
  return guard(async () => {
    const response = await api.request<DriverDocumentSlot[]>('/driver-applications/documents', {
      headers: { [TOKEN_HEADER]: token },
    });

    return response.data;
  });
}

/**
 * Send one file, replacing whatever was held of that type.
 *
 * One request per file rather than the whole set with the form, and ADR-0048
 * §4 argues the trade in full: six photographs at 8 MB is a 48 MB request from
 * a handset on a Ugandan mobile connection, and when it fails at 80% the
 * applicant loses the form as well as the files. One at a time is retryable.
 *
 * The 60-second timeout is the same allowance `uploadDriverDocument` takes,
 * for the same reason: this is a single photograph going up over a weak
 * connection with a person watching it, and unlike a queued transition there
 * is nothing behind it to retry on their behalf. The client's 15-second
 * default would abort a perfectly healthy upload.
 */
export async function uploadApplicationDocument(
  api: ApiClient,
  token: string,
  input: { type: DriverDocumentType; uri: string; expiresAt: string | null },
): Promise<void> {
  const form = new FormData();

  form.append('type', input.type);

  if (input.expiresAt !== null) {
    form.append('expires_at', input.expiresAt);
  }

  // `formFile` rather than a `{ uri, name, type }` descriptor — Expo's fetch
  // refuses that shape outright. The whole argument is in `api/formFile.ts`,
  // and this is its third caller.
  form.append('file', formFile(input.uri));

  await guard(() =>
    api.request('/driver-applications/documents', {
      method: 'POST',
      form,
      headers: { [TOKEN_HEADER]: token },
      timeoutMs: 60_000,
    }),
  );
}

/**
 * Withdraw one, before anybody has decided.
 *
 * Here because an applicant who photographs the wrong side of a logbook can
 * otherwise only fix it by uploading over it — which works, and does nothing
 * for the person who realises they sent a document they did not mean to send
 * at all. The file is destroyed, not merely unlinked.
 */
export async function withdrawApplicationDocument(
  api: ApiClient,
  token: string,
  type: DriverDocumentType,
): Promise<void> {
  await guard(() =>
    api.request(`/driver-applications/documents/${type}`, {
      method: 'DELETE',
      headers: { [TOKEN_HEADER]: token },
    }),
  );
}
