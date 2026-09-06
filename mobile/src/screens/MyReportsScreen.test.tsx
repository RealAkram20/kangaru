import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { SupportRequest } from '../api/endpoints';
import { MyReportsScreen } from './MyReportsScreen';

/**
 * What the office said back (ADR-0044).
 *
 * This screen is the half of the loop that gets skipped, so the assertions are
 * about the two states being told apart in **words**: an answered report shows
 * the reply and says who wrote it, and an unanswered one says nobody has yet
 * rather than looking like a report with an empty answer.
 */

const mockReports = jest.fn();

jest.mock('../support/queries', () => ({ useSupportRequests: () => mockReports() }));

const goBack = jest.fn();

function report(overrides: Partial<SupportRequest> = {}): SupportRequest {
  return {
    id: 1,
    topic: 'passenger',
    topic_label: 'Passenger issue',
    status: 'open',
    status_label: 'Waiting for the office',
    trip_id: null,
    body: 'The passenger refused to pay at Ntinda.',
    answer: null,
    answered_at: null,
    created_at: '2026-08-17T09:00:00+03:00',
    ...overrides,
  };
}

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

async function renderReports(): Promise<ReturnType<typeof render>> {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MyReportsScreen
        navigation={{ goBack } as never}
        route={{ key: 'r', name: 'MyReports' } as never}
      />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockReports.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
});

it('says nobody has answered yet, rather than showing an empty answer', async () => {
  mockReports.mockReturnValue({
    data: [report()],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
  });

  const screen = await renderReports();

  // `answer: null` cannot mean "refused quietly" — ADR-0044 §2 removed the
  // status that would have allowed it — so the screen says which state this is
  // in words rather than leaving a blank.
  expect(screen.getByText('Waiting for the office')).toBeTruthy();
  expect(
    screen.getByText('Nobody has answered yet. You will get a notification when they do.'),
  ).toBeTruthy();
});

it('shows the answer as the office own words, attributed', async () => {
  mockReports.mockReturnValue({
    data: [
      report({
        status: 'answered',
        status_label: 'Answered',
        answer: 'We have credited the missing leg to your wallet.',
        answered_at: '2026-08-17T11:00:00+03:00',
      }),
    ],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
  });

  const screen = await renderReports();

  expect(screen.getByText('We have credited the missing leg to your wallet.')).toBeTruthy();
  // Attributed, because the two texts on this card were written by different
  // people about the same event — without the attribution a driver reads their
  // own words back as if the office had said them.
  expect(screen.getByText(/The office replied/)).toBeTruthy();
  expect(screen.getByText('Answered')).toBeTruthy();
});

it('shows the driver own words in full', async () => {
  const long =
    'The passenger got in at Kampala Road and became abusive when I asked for the fare. '
    + 'He got out at Ntinda without paying and took a photograph of the number plate.';

  mockReports.mockReturnValue({
    data: [report({ body: long })],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
  });

  const screen = await renderReports();

  // A driver checking a report is checking what they *said*. A truncated
  // account is one they cannot verify.
  expect(screen.getByText(long)).toBeTruthy();
});

it('tells a stale list apart from a broken one', async () => {
  mockReports.mockReturnValue({
    data: [report()],
    isLoading: false,
    isError: true,
    refetch: jest.fn(),
    isRefetching: false,
  });

  const stale = await renderReports();

  // The cache is served offline, so an error with rows behind it is a stale
  // list rather than a failure — and the two must not read the same.
  expect(
    stale.getByText('Showing what was saved on this phone. Could not reach the office.'),
  ).toBeTruthy();

  mockReports.mockReturnValue({
    data: [],
    isLoading: false,
    isError: true,
    refetch: jest.fn(),
    isRefetching: false,
  });

  const broken = await renderReports();

  expect(broken.getByText('Could not load your reports.')).toBeTruthy();
});

it('points a driver with no reports at where one starts', async () => {
  const screen = await renderReports();

  // An empty state that only says "nothing here" leaves somebody looking for
  // the door they came through.
  expect(
    screen.getByText('You have not reported anything yet. Help & Safety is where you start one.'),
  ).toBeTruthy();
});
