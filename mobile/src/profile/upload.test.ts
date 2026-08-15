import type { ApiClient } from '../api/client';
import {
  documentFileName,
  documentMimeType,
  uploadDriverDocument,
} from '../api/endpoints';

/**
 * That a document upload actually goes up as a file.
 *
 * **This suite exists because a mutation survived without it.** Rewriting the
 * fetcher to send JSON instead of multipart compiled cleanly, passed every
 * screen test, and would have posted `[object Object]` where the photograph
 * goes — the request reaching the server with no file at all, and a 422 the
 * driver would read as "the office refused my licence".
 *
 * The screen tests mock the mutation, so none of them touches this seam.
 * `httpTransport.test.ts` makes the same argument about the odometer photo.
 */

/** A stand-in for `ApiClient` that records the options it was handed. */
function fakeApi() {
  const calls: { path: string; options: Record<string, unknown> }[] = [];

  const api = {
    request: jest.fn(async (path: string, options: Record<string, unknown>) => {
      calls.push({ path, options });

      return { success: true as const, message: '', data: { id: 1 } };
    }),
  };

  return { api: api as unknown as ApiClient, calls };
}

it('sends the document as multipart, with the file in it', async () => {
  const { api, calls } = fakeApi();

  await uploadDriverDocument(api, {
    type: 'driving_licence',
    uri: 'file:///tmp/licence.jpg',
    expiresAt: '2028-03-14',
  });

  const form = calls[0]?.options.form as FormData | undefined;

  expect(calls[0]?.path).toBe('/me/documents');
  expect(calls[0]?.options.method).toBe('POST');
  // Not `body`: a JSON body would carry the file descriptor object through
  // `JSON.stringify` and arrive as a string the server cannot read.
  expect(calls[0]?.options.body).toBeUndefined();
  expect(form).toBeInstanceOf(FormData);
  expect(form?.get('type')).toBe('driving_licence');
  expect(form?.get('expires_at')).toBe('2028-03-14');
  expect(form?.get('file')).not.toBeNull();
});

it('omits the expiry rather than sending an empty one', async () => {
  const { api, calls } = fakeApi();

  await uploadDriverDocument(api, {
    type: 'identity_document',
    uri: 'file:///tmp/id.jpg',
    expiresAt: null,
  });

  const form = calls[0]?.options.form as FormData | undefined;

  // The server's rule is `nullable|date`; an empty string is neither, and
  // would 422 a document that has no expiry to give.
  expect(form?.get('expires_at')).toBeNull();
});

it('gives the upload longer than the client default', async () => {
  const { api, calls } = fakeApi();

  await uploadDriverDocument(api, {
    type: 'identity_document',
    uri: 'file:///tmp/id.jpg',
    expiresAt: null,
  });

  // 15 seconds is right for a JSON transition that the outbox will retry on
  // the driver's behalf. This is a photograph going up over a Ugandan mobile
  // connection with somebody watching, and nothing behind it to retry.
  expect(calls[0]?.options.timeoutMs).toBe(60_000);
});

it('labels a PDF as a PDF and anything unrecognised as a photo', () => {
  // Asserted on the helpers rather than through the form, because React
  // Native's `FormData` polyfill does not hand a file part back intact — the
  // same limitation `httpTransport.test.ts` works around by exporting its
  // builder.

  // An insurance certificate arrives as a PDF about as often as a photograph,
  // and the server's `mimes` rule is checked against the part's declared type.
  expect(documentMimeType('file:///tmp/cover.pdf')).toBe('application/pdf');
  expect(documentFileName('file:///tmp/cover.pdf')).toBe('cover.pdf');

  expect(documentMimeType('file:///tmp/scan.png')).toBe('image/png');

  // An iPhone hands back `.heic` and `expo-image-picker` transcodes it to
  // jpeg, which the server accepts — the same fallback `httpTransport` makes.
  expect(documentMimeType('file:///tmp/IMG_0042.heic')).toBe('image/jpeg');

  // A uri with no filename at all still gets a name: a nameless part is
  // rejected by the server's `file` rule before any of the others run.
  expect(documentFileName('file:///tmp/')).toBe('document.jpg');
});
