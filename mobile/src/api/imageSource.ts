import { getCurrentToken } from '../auth/currentToken';

/**
 * An `<Image>` source for a picture the API will only hand over to the driver
 * who owns it.
 *
 * ## Why a photograph needs this and a map tile does not
 *
 * ADR-0041 streams the driver's portrait through `GET me/photo` rather than
 * publishing a storage URL, and ADR-0033 §3 gives the reason: a link is
 * addressable by anyone who ever saw it, and this one is fetched every time
 * the drawer opens, so it would travel through proxies, caches and crash
 * reports dozens of times a day. That decision is right and is kept.
 *
 * What it means for the app is that the endpoint sits behind `auth:sanctum`,
 * and **an `<Image>` sends no Authorization header on its own** — so both
 * places that render the portrait were asking for it unauthenticated, getting
 * a 401, and drawing an empty circle. There was nothing on screen to say so:
 * an image that fails to load simply does not appear, which is why a driver
 * whose upload had in fact succeeded still saw no face.
 *
 * The token is read at call time from the same module `ApiClient` reads, so a
 * source built during one session is never reused across a sign-out.
 *
 * The header is omitted rather than sent empty when there is no token: a
 * signed-out app has no business asking, and `Bearer null` would be answered
 * with the same 401 while looking like a credential in a log.
 */
export function authorizedImageSource(uri: string): {
  uri: string;
  headers?: Record<string, string>;
} {
  const token = getCurrentToken();

  return token === null ? { uri } : { uri, headers: { Authorization: `Bearer ${token}` } };
}
