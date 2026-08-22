import type { ApiClient } from '../api/client';
import { uploadApplicationDocument } from './applicationDocuments';

/**
 * That the applicant's claim ticket goes where the server looks for it.
 *
 * **This suite exists because the bug reached a real handset.** The upload
 * sent `upload_token` only as the `X-Upload-Token` header. The server's
 * `resolve()` reads `input('upload_token') ?? header('X-Upload-Token')` and
 * would have accepted that — but `StoreApplicationDocumentRequest` marks
 * `upload_token` **required**, and a FormRequest is validated before the
 * controller runs. So every attempt died at validation:
 *
 * ```
 * 192.168.1.198 "POST /api/v1/driver-applications/documents" 422 166
 * ```
 *
 * three times over, while the screen said *"Not sent — documents need a
 * connection. They are not queued."* The connection was fine. Nothing in the
 * app was wrong except one missing form field, and nothing anywhere said so.
 *
 * `openapi.yaml` has required `[upload_token, type, file]` in the body since
 * the endpoint was written, and `DriverOnboardingDocumentTest` posts it there
 * — the contract and the server always agreed and this client did not, which
 * is exactly the divergence a contract is supposed to catch. It was not
 * caught because nothing asserted the shape of *this* request.
 */

/** A stand-in for `ApiClient` that records the options it was handed. */
function fakeApi() {
  const calls: { path: string; options: Record<string, unknown> }[] = [];

  const api = {
    request: jest.fn(async (path: string, options: Record<string, unknown>) => {
      calls.push({ path, options });

      return { success: true as const, message: '', data: undefined };
    }),
  };

  return { api: api as unknown as ApiClient, calls };
}

const TICKET = 'a'.repeat(64);

it('puts the upload token in the body, where validation looks for it', async () => {
  const { api, calls } = fakeApi();

  await uploadApplicationDocument(api, TICKET, {
    type: 'identity_document',
    uri: 'file:///tmp/id.jpg',
    expiresAt: null,
  });

  const form = calls[0]?.options.form as FormData | undefined;

  expect(calls[0]?.path).toBe('/driver-applications/documents');
  expect(calls[0]?.options.method).toBe('POST');
  expect(form?.get('upload_token')).toBe(TICKET);
});

/**
 * Kept as well as the body field, not instead of it. The `GET` on the same
 * resource has no body to carry the ticket in, so the header is the only
 * mechanism there and removing it from this call would invite someone to
 * remove it from that one.
 */
it('still sends the header, which the read path depends on', async () => {
  const { api, calls } = fakeApi();

  await uploadApplicationDocument(api, TICKET, {
    type: 'identity_document',
    uri: 'file:///tmp/id.jpg',
    expiresAt: null,
  });

  const headers = calls[0]?.options.headers as Record<string, string> | undefined;

  expect(headers?.['X-Upload-Token']).toBe(TICKET);
});

/** The file and the type still have to survive the change above. */
it('sends the file and the type as multipart', async () => {
  const { api, calls } = fakeApi();

  await uploadApplicationDocument(api, TICKET, {
    type: 'driving_licence',
    uri: 'file:///tmp/licence.jpg',
    expiresAt: '2028-03-14',
  });

  const form = calls[0]?.options.form as FormData | undefined;

  expect(calls[0]?.options.body).toBeUndefined();
  expect(form).toBeInstanceOf(FormData);
  expect(form?.get('type')).toBe('driving_licence');
  expect(form?.get('expires_at')).toBe('2028-03-14');
  expect(form?.get('file')).not.toBeNull();
});
