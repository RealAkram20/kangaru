/**
 * "The server rejected our token", broadcast outside React.
 *
 * Lives here for the same reason as `currentToken`: the event originates in
 * `ApiClient` — plain TypeScript with no component behind it — and the
 * listener is the outbox, which is also not a component. Routing it through a
 * ref inside a provider would put React in the middle of a conversation
 * neither party is having.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Returns an unsubscribe function shaped for a `useEffect` cleanup. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  listeners.forEach((listener) => listener());
}
