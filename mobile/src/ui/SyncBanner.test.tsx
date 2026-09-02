import { render } from '@testing-library/react-native';

import { SyncBanner } from './SyncBanner';

/**
 * The strip is silent now, by the owner's decision (2026-08-28).
 *
 * ## What these tests used to protect, and why they went
 *
 * Five of them pinned the wording of the queue states — "Sending 3 updates…"
 * only while the queue was actually moving, "Can't reach the office" rather
 * than blaming the phone, and a parked item outranking everything else. They
 * existed because the strip once said **"Sending 3 updates…"** on the owner's
 * handset over a queue that had not moved and an API that was down, with the
 * count climbing between two screenshots a minute apart.
 *
 * None of those sentences is rendered any more, so the tests were deleted
 * rather than left asserting nothing. They are in git beside the wording they
 * guarded, and both come back together if the banner is ever reinstated.
 *
 * ## What is still worth protecting
 *
 * That the strip stays quiet whatever the queue is doing — the owner asked
 * for silence, and a banner that reappears on some state nobody thought to
 * check is the thing they asked to be rid of — and that the **storage
 * failure still speaks**, because that one is an instruction rather than a
 * status: every trip button is about to refuse, and without this sentence
 * that reads as a broken app.
 */

const mockSync = jest.fn();

jest.mock('../offline/SyncProvider', () => ({ useSync: () => mockSync() }));

/** The provider's state, with everything quiet unless a test says otherwise. */
function syncState(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    online: true,
    pending: 0,
    stalled: false,
    parked: [],
    queued: new Map(),
    bufferedPings: 0,
    lastSyncedAt: null,
    storageFailed: false,
    ...overrides,
  };
}

it('stays silent through every state the queue can be in', async () => {
  /*
    One test over all of them rather than five, because the assertion is now
    the same in every case and the interesting question is only whether some
    state was forgotten. Each of these rendered a band before 2026-08-28:
    amber for no connection, grey for work in hand, red for a parked item.
  */
  const states = [
    syncState(),
    syncState({ online: false }),
    syncState({ pending: 3 }),
    syncState({ bufferedPings: 40 }),
    syncState({ online: true, pending: 3, stalled: true }),
    syncState({ parked: [{ id: 'a' }] }),
    syncState({ online: false, pending: 2, bufferedPings: 12, parked: [{ id: 'a' }] }),
  ];

  for (const state of states) {
    mockSync.mockReturnValue(state);

    const { toJSON } = await render(<SyncBanner />);

    expect(toJSON()).toBeNull();
  }
});

it('still says so when the phone itself cannot save anything', async () => {
  // Not a sync status — an instruction. Every trip button is about to refuse,
  // and this sentence is what stops that reading as a broken app.
  mockSync.mockReturnValue(syncState({ storageFailed: true }));

  const { getByText } = await render(<SyncBanner />);

  expect(getByText(/offline storage could not be opened/)).toBeTruthy();
});
