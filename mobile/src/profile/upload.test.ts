import type { ApiClient } from '../api/client';
import { uploadDriverDocument } from '../api/endpoints';
import { formFile } from '../api/formFile';

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

it('sends a part the runtime can actually serialise, not a uri descriptor', () => {
  // **The regression this file now exists for above all others.** Every upload
  // in this app used to append `{ uri, name, type }`, React Native's own file
  // descriptor. Expo SDK 54 replaced the global `fetch` with a WinterCG one
  // that converts the `FormData` itself and throws `Unsupported FormDataPart
  // implementation` on that shape — so the photograph, the documents and the
  // odometer photo all failed inside `fetch`, were classified as
  // `NetworkError`, and were reported to drivers as "no connection" for as
  // long as those endpoints had existed.
  //
  // Asserted on `formFile` rather than through the form, because the `FormData`
  // under jest is not the one Expo patches at runtime: it stringifies anything
  // that is not a `Blob`, so a part read back here says nothing about what the
  // device would send. What can be checked is the contract Expo's converter
  // applies — a part is sendable only if it is a string, a `Blob`, or carries
  // `bytes()` — and that is what is checked.
  const part = formFile('file:///tmp/IMG_0042.jpg') as unknown as {
    name?: string;
    type?: string;
    bytes?: () => Promise<Uint8Array>;
  };

  expect(typeof part.bytes).toBe('function');

  // Named and typed by the file itself now rather than guessed from the end of
  // the uri — which is how a transcoded `.heic` used to be described as
  // whatever its name still said.
  expect(part.name).toBe('IMG_0042.jpg');
  expect(part.type).toBe('image/jpeg');
});