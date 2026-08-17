import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { LegalDocuments, OfficeContact } from '../api/endpoints';
import { SafetyScreen } from './SafetyScreen';

/**
 * Help & Safety, and the one control on it that could get somebody hurt.
 *
 * **There was no test file for this screen at all** until now — the
 * 2026-08-16 worklog entry says the Safety and Support screens "rendered from
 * that same payload shape in their tests", and no such file existed for
 * either. So the first job here is the ordinary one: prove the screen mounts.
 *
 * The rest of it guards the SOS button, which the previous version of this
 * screen refused to build. It exists now because it dials rather than reports
 * (see the screen's docblock), and **that distinction is only true while these
 * assertions hold**:
 *
 * - **No number published → no red button.** This is the important one. A dead
 *   SOS is exactly the control that was refused: it would summon nobody and
 *   look like it summoned somebody.
 * - **Pressing it opens the dialler**, on the office's number, and does not
 *   post, log or confirm anything.
 * - **The number is on the face of the card**, because the office configures it
 *   and it differs by country.
 * - **A screen reader hears the act, not the letters.**
 *
 * It also pins the position sentence, which the mockup does not draw and which
 * is the only place in the app that tells a driver whether the platform can
 * currently see them.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockFetchOfficeContact = jest.fn();
const mockFetchLegalDocuments = jest.fn();
const mockUseDutyToggle = jest.fn();

jest.mock('../api/endpoints', () => ({
  fetchOfficeContact: (...args: unknown[]) => mockFetchOfficeContact(...args),
  fetchLegalDocuments: (...args: unknown[]) => mockFetchLegalDocuments(...args),
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ api: {} }),
}));

jest.mock('../duty/useDutyToggle', () => ({
  useDutyToggle: () => mockUseDutyToggle(),
}));

const navigate = jest.fn();
const goBack = jest.fn();

const navigation = { navigate, goBack } as never;

function office(overrides: Partial<OfficeContact> = {}): OfficeContact {
  return {
    name: 'KangaruRide',
    email: 'office@example.test',
    phone: '+256 700 123 456',
    emergency: '999',
    ...overrides,
  };
}

function legal(overrides: Partial<LegalDocuments> = {}): LegalDocuments {
  return { terms: 'Terms', privacy: 'Privacy', safety: '', ...overrides };
}

async function renderSafety(): Promise<ReturnType<typeof render>> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  const node: ReactElement = (
    <SafetyScreen
      route={{ key: 'safety', name: 'Safety', params: undefined }}
      navigation={navigation}
    />
  );

  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  goBack.mockClear();
  mockFetchOfficeContact.mockResolvedValue(office());
  mockFetchLegalDocuments.mockResolvedValue(legal());
  mockUseDutyToggle.mockReturnValue({ onDuty: true });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// -- The emergency control -------------------------------------------------

it('draws no red button at all when the office has published no emergency number', async () => {
  mockFetchOfficeContact.mockResolvedValue(office({ emergency: null }));

  const screen = await renderSafety();

  // Wait on the branch that *should* render, then prove the other did not.
  expect(await screen.findByText(/No emergency number published/i)).toBeTruthy();

  // The whole reason an SOS is defensible here. A button that summons nobody is
  // the control the first version of this screen refused outright.
  expect(screen.queryByText('SOS')).toBeNull();
  expect(screen.queryByText('Emergency')).toBeNull();
  // A successful read that came back empty is a fact about the office, and this
  // is the one state allowed to say so.
  expect(screen.queryByText(/not loaded/i)).toBeNull();
});

it('never claims the office published nothing when it simply could not load', async () => {
  /*
    A cold start upcountry with no signal and nothing cached — a routine way to
    open this screen. The old wording asserted a fact about the office that the
    app had no way to know, on the screen where being believed matters most.
  */
  mockFetchOfficeContact.mockRejectedValue(new Error('offline'));

  const screen = await renderSafety();

  expect(await screen.findByText(/Emergency number not loaded/i)).toBeTruthy();
  expect(screen.queryByText(/No emergency number published/i)).toBeNull();
  // And still no red button, which is the property that must hold in every
  // no-number state.
  expect(screen.queryByText('SOS')).toBeNull();
});

it('dials the office’s emergency number, and shows which number that is', async () => {
  const screen = await renderSafety();

  expect(await screen.findByText('SOS')).toBeTruthy();
  // On the face of the card, not only in the accessibility label: the office
  // configures this and it differs by country.
  expect(screen.getByText('999')).toBeTruthy();
  expect(screen.getByText('Tap to call emergency services')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText(/Call emergency services on 999/i));

  expect(Linking.openURL).toHaveBeenCalledWith('tel:999');
  // Nothing is posted, and nothing is navigated to. It is a phone call.
  expect(navigate).not.toHaveBeenCalled();
});

it('strips spaces from the number before dialling, so a formatted one still connects', async () => {
  mockFetchOfficeContact.mockResolvedValue(office({ emergency: '112 999' }));

  const screen = await renderSafety();

  await fireEvent.press(await screen.findByLabelText(/Call emergency services/i));

  expect(Linking.openURL).toHaveBeenCalledWith('tel:112999');
});

it('announces the act rather than the three letters', async () => {
  const screen = await renderSafety();

  // "Emergency, S O S" tells a screen-reader user nothing about what happens.
  const label = (await screen.findByLabelText(/Call emergency services on 999/i)).props
    .accessibilityLabel as string;

  expect(label).toContain('Call emergency services');
  expect(label).not.toMatch(/\bSOS\b/);
});

// -- The sentence the mockup does not draw ---------------------------------

it('tells an off-duty driver that nobody can see where they are', async () => {
  mockUseDutyToggle.mockReturnValue({ onDuty: false });

  const screen = await renderSafety();
  await screen.findByText('SOS');

  expect(screen.getByText('Nobody can see where you are')).toBeTruthy();
  expect(screen.getByText(/Say where you are when you call/i)).toBeTruthy();
  expect(screen.queryByText('The office can see where you are')).toBeNull();
});

it('tells an on-duty driver the office can find them without being told', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');

  expect(screen.getByText('The office can see where you are')).toBeTruthy();
  expect(screen.queryByText('Nobody can see where you are')).toBeNull();
});

// -- Help topics -----------------------------------------------------------

it('lists the five help topics the mockup draws', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');

  expect(screen.getByText('Report something to the office')).toBeTruthy();

  for (const label of [
    'Report an issue',
    'Passenger issue',
    'Vehicle issue',
    'Payment issue',
    'Lost item',
  ]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

it('opens the report form with the topic named, not a second contact card', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');

  await fireEvent.press(screen.getByText('Payment issue'));

  /*
    **This assertion inverted with ADR-0044, and the old one is worth
    remembering.** It read `toHaveBeenCalledWith('Support', …)`, and the
    comment beside it said the topic param was what stopped the rows being
    "five routes to one screen". It was the best a screen with no backend could
    do, and the owner still read the result as *"repeated and fake"* — five
    rows that opened one phone number.

    Now each opens a form whose report a person at the office answers.
  */
  expect(navigate).toHaveBeenCalledWith('ReportIssue', { topic: 'payment' });
});

it('says on the row what each topic is for, not only to a screen reader', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');

  /*
    The defect behind *"repeated"*. Each summary was passed as `announcement`
    alone, so a screen reader could tell the five rows apart and the eye could
    not — five identical chevron rows, one destination.

    `getByText`, not `getByLabelText`: an accessibility label would pass this
    assertion in exactly the state that was wrong.
  */
  expect(screen.getByText('A fare, a bonus, or a wallet balance that looks wrong.')).toBeTruthy();
  expect(
    screen.getByText('Something a passenger left in the vehicle, or something of yours gone missing.'),
  ).toBeTruthy();
});

it('offers the way back to what was already reported', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');

  // The half of the loop that gets skipped: a report queue nobody can read the
  // answer in is the silence ADR-0044 exists to end.
  await fireEvent.press(screen.getByText('Your reports'));

  expect(navigate).toHaveBeenCalledWith('MyReports');
});

// -- Contact support -------------------------------------------------------

it('sends the contact support card to support with no topic at all', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');

  await fireEvent.press(screen.getByText('Contact Support'));

  // Not `{ topic: undefined }` — this card is the catch-all, and the screen it
  // opens must render its own general lead.
  expect(navigate).toHaveBeenCalledWith('Support');
});

// -- The office's own words ------------------------------------------------

it('renders the office guidance as separate paragraphs, and nothing when there is none', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');
  expect(screen.queryByText('Staying safe')).toBeNull();

  mockFetchLegalDocuments.mockResolvedValue(
    legal({ safety: 'Park in the light.\n\nKeep the doors locked.' }),
  );

  const withGuidance = await renderSafety();

  expect(await withGuidance.findByText('Staying safe')).toBeTruthy();
  // Split, not run together: this is read in a hurry.
  expect(withGuidance.getByText('Park in the light.')).toBeTruthy();
  expect(withGuidance.getByText('Keep the doors locked.')).toBeTruthy();
});

it('never prints the office’s emphasis markers at the driver', async () => {
  // What the device showed before this was fixed: the most important sentence in
  // the guidance, wrapped in literal asterisks, on the screen that can least
  // afford to look broken.
  mockFetchLegalDocuments.mockResolvedValue(
    legal({ safety: 'On duty you are visible. **That stops when you go off duty.**' }),
  );

  const screen = await renderSafety();

  expect(await screen.findByText('That stops when you go off duty.')).toBeTruthy();
  expect(JSON.stringify(screen.toJSON())).not.toContain('**');
});

it('says plainly that no emergency channel is monitored in the app', async () => {
  const screen = await renderSafety();
  await screen.findByText('SOS');

  expect(screen.getByText(/does not monitor emergencies/i)).toBeTruthy();
});
