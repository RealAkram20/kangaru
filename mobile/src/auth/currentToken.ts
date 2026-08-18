/**
 * The bearer token, held outside React.
 *
 * It lives here rather than in a ref or in state because it is not really
 * component state: one token belongs to the whole process, `ApiClient` needs
 * to read the *current* one at request time — not the one captured when a
 * screen last rendered — and a token change must not invalidate every memo and
 * query that closed over the client.
 *
 * This is a cache of what `tokenStore` holds in the keystore, never the
 * authority. `AuthProvider` writes both.
 */
let token: string | null = null;

export function getCurrentToken(): string | null {
  return token;
}

export function setCurrentToken(value: string | null): void {
  token = value;
}
