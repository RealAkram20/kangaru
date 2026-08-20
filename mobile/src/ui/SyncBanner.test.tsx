import { render } from '@testing-library/react-native';

import { SyncBanner } from './SyncBanner';

/**
 * The one strip in the app whose whole job is telling a driver the truth about
 * where their work is.
 *
 * It had no test at all — every screen mocks it away — which is how it came to
 * say **"Sending 3 updates…"** on the owner's handset over a queue that had
 * not moved and an API that was down. The count climbed from 1 to 3 between
 * two screenshots a minute apart. A driver reading "Sending" concludes the
 * office has their work, and that is precisely the belief this strip exists to
 * prevent.
 *
 * `docs/screen-rules.md` §1 is the rule: the app does not state what it cannot
 * observe, and *progress* is a value like any other.
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
    ...overrides,
  };
}

it('says nothing at all when there is nothing to say', async () => {
  // A permanent green tick trains people to ignore the strip that later turns
  // red, which is the whole reason this renders null.
  mockSync.mockReturnValue(syncState());

  const { toJSON } = await render(<SyncBanner />);

  expect(toJSON()).toBeNull();
});

it('claims it is sending only while the queue is actually moving', async () => {
  mockSync.mockReturnValue(syncState({ pending: 3 }));

  const { getByText } = await render(<SyncBanner />);

  expect(getByText('Sending 3 updates…')).toBeTruthy();
});

it('stops claiming to send once the queue has stopped moving', async () => {
  // The owner's screenshot. NetInfo says the phone is online — it has wifi —
  // and the office is unreachable, which `online` alone cannot distinguish.
  mockSync.mockReturnValue(syncState({ pending: 3, stalled: true }));

  const { getByText, queryByText } = await render(<SyncBanner />);

  expect(queryByText(/Sending/)).toBeNull();
  expect(getByText("Can't reach the office. 3 updates saved on this phone, still trying.")).toBeTruthy();
});

it('does not blame the phone for the office being away', async () => {
  // The driver can see they have signal. "No connection" would send them
  // looking for a mast, and would be false.
  mockSync.mockReturnValue(syncState({ pending: 1, stalled: true }));

  const { queryByText, getByText } = await render(<SyncBanner />);

  expect(queryByText(/No connection/)).toBeNull();
  // And the reassurance a driver actually needs, which is that the work is
  // not lost — the same promise the offline wording makes.
  expect(getByText(/saved on this phone/)).toBeTruthy();
});

it('keeps saying no connection when there genuinely is none', async () => {
  mockSync.mockReturnValue(syncState({ online: false, pending: 2 }));

  const { getByText } = await render(<SyncBanner />);

  expect(getByText('No connection. 2 updates saved on this phone, waiting to send.')).toBeTruthy();
});

it('never says a queue is stalled when the queue is empty', async () => {
  // An idle queue is not a stalled one. Without this the strip would appear
  // over every screen the moment a drain found nothing to do.
  mockSync.mockReturnValue(syncState({ stalled: true }));

  const { toJSON } = await render(<SyncBanner />);

  expect(toJSON()).toBeNull();
});

it('lets an item that needs a person outrank everything else', async () => {
  // A parked item is the only thing here a driver must act on, so it keeps
  // the red band and its own sentence whatever the queue is doing.
  mockSync.mockReturnValue(
    syncState({ pending: 3, stalled: true, parked: [{ id: 'a' } as never] }),
  );

  const { getByText } = await render(<SyncBanner />);

  expect(getByText(/needs your attention/)).toBeTruthy();
});
