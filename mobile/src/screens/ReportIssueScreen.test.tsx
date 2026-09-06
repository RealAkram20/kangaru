import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReportIssueScreen } from './ReportIssueScreen';

/**
 * Writing a report to the office (ADR-0044).
 *
 * The properties worth pinning are the ones a driver is trusting the screen
 * with: that what they typed is what gets sent, that they are told *before*
 * writing it when there is no connection, and that a sent report cannot be
 * sent twice by walking back into the form.
 */

const mockCreate = jest.fn();
const mockPending = jest.fn();
const mockOnline = jest.fn();

jest.mock('../support/queries', () => ({
  useCreateSupportRequest: () => ({ mutate: mockCreate, ...mockPending() }),
}));
jest.mock('../offline/SyncProvider', () => ({ useSync: () => ({ online: mockOnline() }) }));

const goBack = jest.fn();
const replace = jest.fn();

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

async function renderForm(topic = 'passenger'): Promise<ReturnType<typeof render>> {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ReportIssueScreen
        navigation={{ goBack, replace } as never}
        route={{ key: 'r', name: 'ReportIssue', params: { topic } } as never}
      />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockCreate.mockClear();
  goBack.mockClear();
  replace.mockClear();
  mockPending.mockReturnValue({ isPending: false, isError: false, error: null });
  mockOnline.mockReturnValue(true);
});

it('names the topic the driver chose rather than asking again', async () => {
  const screen = await renderForm('vehicle');

  // The driver said what this was about by tapping a row. A picker here would
  // be the app forgetting what it was just told — and would default every
  // report into the catch-all bucket.
  expect(screen.getByText('Vehicle issue')).toBeTruthy();
  expect(
    screen.getByText('A breakdown, damage, or something that makes the vehicle unsafe to drive.'),
  ).toBeTruthy();
});

it('shows what the office needs, above the box rather than inside it', async () => {
  const screen = await renderForm('passenger');

  // Placeholder text vanishes at the first character — exactly when it starts
  // being useful. These have to survive typing.
  expect(screen.getByText('The trip number')).toBeTruthy();
  expect(screen.getByText('What the passenger did')).toBeTruthy();
});

it('sends what the driver typed, trimmed, under the chosen topic', async () => {
  const screen = await renderForm('payment');

  await fireEvent.changeText(
    screen.getByLabelText('What happened'),
    '  Tuesday fare is short by five thousand shillings.  ',
  );
  await fireEvent.press(screen.getByText('Send to the office'));

  expect(mockCreate).toHaveBeenCalledWith(
    { topic: 'payment', body: 'Tuesday fare is short by five thousand shillings.' },
    expect.anything(),
  );
});

it('will not send a report too short for the office to act on', async () => {
  const screen = await renderForm();

  await fireEvent.changeText(screen.getByLabelText('What happened'), 'bad');
  await fireEvent.press(screen.getByText('Send to the office'));

  // The server's own floor, enforced here so a driver learns it from the form
  // rather than from a rejection.
  expect(mockCreate).not.toHaveBeenCalled();
  expect(screen.getByText('Add a little more so the office can act on it.')).toBeTruthy();
});

it('says there is no connection before the driver writes, not after', async () => {
  mockOnline.mockReturnValue(false);

  const screen = await renderForm();

  // A report is not queued (ADR-0044 §5). Finding that out after typing an
  // account of what happened is the worst moment to learn it.
  expect(
    screen.getByText(
      'No connection. A report is sent straight to the office, so this one needs signal — your work is still saved as usual.',
    ),
  ).toBeTruthy();
});

it('replaces the form with the list once it is sent, so it cannot be sent twice', async () => {
  mockCreate.mockImplementation((_input, handlers) => handlers.onSuccess?.());

  const screen = await renderForm();

  await fireEvent.changeText(
    screen.getByLabelText('What happened'),
    'The passenger refused to pay and left.',
  );
  await fireEvent.press(screen.getByText('Send to the office'));

  // `replace`, not `navigate`: backing out of the confirmation must not land
  // on a filled-in form that has already been sent.
  await waitFor(() => expect(replace).toHaveBeenCalledWith('MyReports'));
});

it('promises no answer by any particular time', async () => {
  const screen = await renderForm();

  // There is no SLA (ADR-0044 §5). "Within 24 hours" here would commit
  // somebody else's desk to a deadline nothing enforces.
  const rendered = JSON.stringify(screen.toJSON());

  expect(rendered).not.toMatch(/24 hours|within a day|shortly/i);
  expect(
    screen.getByText(
      'A person at the office reads this and writes back. Their answer appears in Your reports, and you will get a notification.',
    ),
  ).toBeTruthy();
});

it('degrades to a way out when the topic is from an older build', async () => {
  const screen = await renderForm('carrier-pigeon');

  // A stale deep link, not a state worth building a screen for. It must not
  // render a form that posts an unknown topic the server will refuse.
  expect(
    screen.getByText('That topic is no longer available. Go back and choose one from Help & Safety.'),
  ).toBeTruthy();
  expect(screen.queryByLabelText('What happened')).toBeNull();
});
