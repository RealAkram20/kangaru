import { fireEvent, render, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverNotification } from '../api/endpoints';
import { NotificationsScreen } from './NotificationsScreen';

/**
 * The driver's inbox (ADR-0039).
 *
 * Three properties carry this screen, and each of them is a rule rather than a
 * preference:
 *
 * 1. **Unread is never the tint alone** — `docs/screen-rules.md` §6. The list
 *    is entirely text, so a driver in direct sun who cannot see a background
 *    wash has to have something else to go on.
 * 2. **A kind of message is chosen by `type`, never by its words.** A test
 *    that passed on the subject line would go on passing after the first
 *    translation broke the screen.
 * 3. **A control that would do nothing is not drawn.** *Mark all as read* on
 *    an inbox with nothing unread is a button a driver presses and learns to
 *    distrust.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockUseNotifications = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAll = jest.fn();
const mockMarkAllState = jest.fn(() => ({ isPending: false, isError: false }));
const mockRefetch = jest.fn();

jest.mock('../notifications/queries', () => ({
  useNotifications: () => mockUseNotifications(),
  useMarkNotificationRead: () => ({ mutate: mockMarkRead }),
  useMarkAllNotificationsRead: () => ({ mutate: mockMarkAll, ...mockMarkAllState() }),
}));

const OFFER: DriverNotification = {
  id: 41,
  type: 'trip.offered',
  type_label: 'New job',
  subject: 'New job — 3.2 km away',
  body: 'Pickup at Kireka Stage. Tap to accept within 15 seconds.',
  url: null,
  context: { offer_id: 7 },
  is_read: false,
  read_at: null,
  created_at: '2026-08-15T11:48:00Z',
};

const APPROVED: DriverNotification = {
  id: 40,
  type: 'booking.approved',
  type_label: 'Booking approved',
  subject: 'Booking approved',
  body: 'Your Tuesday airport run was approved by the office.',
  url: '/bookings/12',
  context: null,
  is_read: true,
  read_at: '2026-08-15T09:10:00Z',
  created_at: '2026-08-15T09:00:00Z',
};

const goBack = jest.fn();

async function renderInbox(
  notifications: DriverNotification[] = [OFFER, APPROVED],
  state: { isLoading?: boolean; isError?: boolean; unread?: number | null } = {},
): Promise<ReturnType<typeof render>> {
  mockUseNotifications.mockReturnValue({
    data: { notifications, unread: state.unread ?? null },
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isRefetching: false,
    refetch: jest.fn(),
  });

  const node: ReactElement = (
    <NotificationsScreen
      route={{ key: 'n', name: 'Notifications', params: undefined }}
      navigation={{ goBack, navigate: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  goBack.mockClear();
  mockMarkRead.mockClear();
  mockMarkAll.mockClear();
  mockUseNotifications.mockClear();
  mockRefetch.mockClear();
  mockMarkAllState.mockReturnValue({ isPending: false, isError: false });
  jest.useFakeTimers();
  // Saturday 15 August 2026, 12:00 UTC — twelve minutes after the offer above.
  jest.setSystemTime(new Date('2026-08-15T12:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

// -- The list --------------------------------------------------------------

it('draws each message with its subject, its body and when it arrived', async () => {
  const screen = await renderInbox();

  expect(screen.getByText('New job — 3.2 km away')).toBeTruthy();
  expect(screen.getByText('Pickup at Kireka Stage. Tap to accept within 15 seconds.')).toBeTruthy();
  expect(screen.getByText('12 minutes ago')).toBeTruthy();
  expect(screen.getByText('Booking approved')).toBeTruthy();
  expect(screen.getByText('3 hours ago')).toBeTruthy();
});

it('announces unread as a word, not only as a dot', async () => {
  // `docs/screen-rules.md` §6. The dot and the heavier subject are for the
  // eye; this is the same fact for everyone else, and it leads the sentence
  // because it decides whether the rest is worth hearing.
  const screen = await renderInbox();

  expect(
    screen.getByLabelText(
      'Unread. New job. New job — 3.2 km away. Pickup at Kireka Stage. Tap to accept within 15 seconds. 12 minutes ago',
    ),
  ).toBeTruthy();

  // The read one says the same things without the word.
  expect(
    screen.getByLabelText(
      'Booking approved. Booking approved. Your Tuesday airport run was approved by the office. 3 hours ago',
    ),
  ).toBeTruthy();
});

it('marks unread with a dot and a heavier subject, not with a tint', async () => {
  // `docs/screen-rules.md` §6, and this is the check that bites: a list that
  // is entirely text has nothing else to separate read from unread for a
  // driver in direct sun. One dot for one unread message, and the two
  // subjects are drawn in different weights.
  const screen = await renderInbox();

  // **Inside the unread row**, not merely somewhere on the screen. Counting
  // dots passed a mutation that moved the dot onto the *read* row instead —
  // one dot either way, and the count could not tell the difference.
  expect(within(screen.getByLabelText(/^Unread\. /)).getByTestId('unread-dot')).toBeTruthy();
  expect(
    within(screen.getByLabelText(/^Booking approved\. /)).queryByTestId('unread-dot'),
  ).toBeNull();

  const unread = StyleSheet.flatten(screen.getByText('New job — 3.2 km away').props.style) as {
    fontFamily: string;
  };
  const read = StyleSheet.flatten(screen.getByText('Booking approved').props.style) as {
    fontFamily: string;
  };

  expect(unread.fontFamily).toBe('Inter_600SemiBold');
  expect(read.fontFamily).toBe('Inter_400Regular');
});

it('lets a driver pull the list down, because the error copy tells them to', async () => {
  // Copy that names an interaction the screen does not implement is worse
  // than no copy: a driver on a patchy upcountry connection pulls, nothing
  // happens, and concludes the app is broken rather than the network.
  // `PerformanceScreen` shipped exactly this and it was found by reading.
  mockUseNotifications.mockReturnValue({
    data: { notifications: [], unread: null },
    isLoading: false,
    isError: true,
    isRefetching: false,
    refetch: mockRefetch,
  });

  const screen = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationsScreen
        route={{ key: 'n', name: 'Notifications', params: undefined }}
        navigation={{ goBack, navigate: jest.fn() } as never}
      />
    </SafeAreaProvider>,
  );

  const scroll = screen.getByTestId('notifications-scroll');

  expect(scroll.props.refreshControl).toBeTruthy();

  scroll.props.refreshControl.props.onRefresh();

  expect(mockRefetch).toHaveBeenCalled();
});

it('names the kind of message in the sentence, which the row does not print', async () => {
  // The glyph carries the kind for the eye and its colour is never the only
  // thing saying so (DESIGN.md §3). `type_label` is the same fact in words.
  const screen = await renderInbox([APPROVED]);

  expect(screen.getByLabelText(/^Booking approved\. /)).toBeTruthy();
  // ...and it is not drawn twice: the subject already says it.
  expect(screen.getAllByText('Booking approved')).toHaveLength(1);
});

// -- Reading one -----------------------------------------------------------

it('marks an unread message read when it is tapped', async () => {
  const screen = await renderInbox();

  await fireEvent.press(screen.getByLabelText(/^Unread\. /));

  expect(mockMarkRead).toHaveBeenCalledWith(41);
});

it('does not re-mark one that is already read', async () => {
  // A read receipt for something already read is a request that changes
  // nothing, sent every time a driver's thumb brushes the list.
  const screen = await renderInbox();

  await fireEvent.press(screen.getByLabelText(/^Booking approved\. /));

  expect(mockMarkRead).not.toHaveBeenCalled();
});

// -- Mark all as read ------------------------------------------------------

it('offers Mark all as read while something is unread', async () => {
  const screen = await renderInbox();

  await fireEvent.press(screen.getByLabelText('Mark all as read'));

  expect(mockMarkAll).toHaveBeenCalled();
});

it('draws no Mark all as read when the whole list has been read', async () => {
  // Derived from the list in hand, not from `meta.unread` — that field is
  // nullable, and a null there must not be read as "nothing unread".
  const screen = await renderInbox([APPROVED]);

  expect(screen.queryByLabelText('Mark all as read')).toBeNull();
});

it('says so when marking everything read did not reach the office', async () => {
  // The single mark fails silently on purpose; this one must not. A button
  // somebody pressed that appears to do nothing is the one they press again.
  mockMarkAllState.mockReturnValue({ isPending: false, isError: true });

  const screen = await renderInbox();

  expect(screen.getByText(/Not sent/)).toBeTruthy();
});

// -- The states around the list --------------------------------------------

it('says the inbox is empty, and where job offers actually arrive', async () => {
  // The bell on the home screen counts offers and this does not. Two badges
  // meaning the same thing would make both mean nothing.
  const screen = await renderInbox([]);

  expect(screen.getByText(/Nothing from the office yet/)).toBeTruthy();
  expect(screen.queryByLabelText('Mark all as read')).toBeNull();
});

it('reports a load failure rather than drawing an empty inbox', async () => {
  // An empty list and a list that did not arrive are different facts, and the
  // second one must not read as "the office has said nothing".
  const screen = await renderInbox([], { isError: true });

  expect(screen.getByText(/Could not load your notifications/)).toBeTruthy();
  expect(screen.queryByText(/Nothing from the office yet/)).toBeNull();
});

it('renders a type it has never seen rather than dropping the row', async () => {
  // The server's enum can gain a case tomorrow and every installed handset
  // still has to draw the message. The subject, the body and the timestamp
  // are all still true; only the glyph is unknown.
  const screen = await renderInbox([
    { ...OFFER, id: 99, type: 'document.expiring', type_label: 'Document expiring' },
  ]);

  expect(screen.getByText('New job — 3.2 km away')).toBeTruthy();
  expect(screen.getByLabelText(/^Unread\. Document expiring\. /)).toBeTruthy();
});
