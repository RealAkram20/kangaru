import { File } from 'expo-file-system';

/**
 * A file on this handset, in the one shape `fetch` will actually send.
 *
 * ## The bug this exists to end
 *
 * Every upload in this app used React Native's proprietary file descriptor —
 * `form.append('file', { uri, name, type })` — which is what React Native's
 * own `fetch` has always taken. **Expo SDK 54 replaced the global `fetch`**
 * with its WinterCG implementation, and that one converts a `FormData` itself
 * (`expo/src/winter/fetch/convertFormData.ts`). It accepts a string, a `Blob`,
 * or anything with a `bytes()` method, and for anything else — the descriptor
 * above — it throws `Unsupported FormDataPart implementation`. Its own comment
 * is explicit: *"`uri` is not supported for React Native's FormData."*
 *
 * The throw happens inside `fetch`, so `ApiClient` classified it as a
 * `NetworkError` and three screens told the driver they had no signal. Nothing
 * caught it: the descriptor is still valid TypeScript, jest never runs Expo's
 * converter, and the failure only exists on a device.
 *
 * **All three upload paths were dead, not one** — the driver's photograph,
 * their documents, and the odometer dashboard photo. The third is the one that
 * mattered: it is the anchor client's evidence for a reading and it fails
 * through the outbox, so a driver learns about it as a parked queue item hours
 * after leaving the vehicle.
 *
 * ## Why `expo-file-system`'s `File` and not a hand-built part
 *
 * It satisfies the converter's `bytes()` branch, and it carries its own `name`
 * and `type` — which is **better than the extension-guessing helpers it
 * replaces**, not merely equivalent. Those read the mime off the end of the
 * uri and labelled anything unrecognised `image/jpeg`; this is sniffed from
 * the file itself, so an iPhone `.heic` that `expo-image-picker` transcoded is
 * described as what it now is rather than what its name still says.
 *
 * Constructing one touches no disk — the bytes are read by the converter when
 * the request is built — so this stays usable from `buildTransitionForm`,
 * which is synchronous and is called while an outbox item is being sent.
 *
 * The `Blob` cast is for TypeScript only: `FormData.append` is typed against
 * the browser's, and `File` implements `Blob` without extending it.
 */
export function formFile(uri: string): Blob {
  return new File(uri) as unknown as Blob;
}
