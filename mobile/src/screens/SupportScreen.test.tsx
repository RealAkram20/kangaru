import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { OfficeContact } from '../api/endpoints';
import { SupportScreen } from './SupportScreen';

/**
 * Reaching a person at the office, with and without a topic.
 *
 * **There was no test file for this screen either.** Two properties matter
 * enough to pin:
 *
 * 1. **A topic changes what the driver is prompted for, and nothing else.** It
 *    is never submitted, because there is nowhere on this platform to submit it
 *    to. The suite proves there is no text box and no send control.
 * 2. **Without a topic the screen is what it always was.** The drawer reaches
 *    it with no params, and that route must not have quietly become a
 *    topic-shaped screen with an empty topic.
 *
 * Plus the refusal that predates all of this: an unconfigured deployment gets a
 * sentence, never a plausible-looking phone number.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockFetchOfficeContact = jest.fn();
const mockUseDriverProfile = jest.fn();

jest.mock('../api/endpoints', () => ({
  fetchOfficeContact: (...args: unknown[]) => mockFetchOfficeContact(...args),
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ api: {} }),
}));

jest.mock('../profile/queries', () => ({
  useDriverProfile: () => mockUseDriverProfile(),
}));

const goBack = jest.fn();
const navigation = { goBack, navigate: jest.fn() } as never;

function office(overrides: Partial<OfficeContact> = {}): OfficeContact {
  return {
    name: 'KangaruRide',
    email: 'office@example.test',
    phone: '+256 700 123 456',
    emergency: '999',
    ...overrides,
  };
}

async function renderSupport(topic?: string): Promise<ReturnType<typeof render>> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const node: ReactElement = (
    <SupportScreen
      route={{
        key: 'support',
        name: 'Support',
        params: topic === undefined ? undefined : { topic },
      }}
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
  goBack.mockClear();
  mockFetchOfficeContact.mockResolvedValue(office());
  mockUseDriverProfile.mockReturnValue({
    data: { name: 'Alice Nakato', phone: '+256 772 000 111', vehicle: null },
  });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('renders the plain contact screen when no topic is named', async () => {
  const screen = await renderSupport();

  expect(await screen.findByText('Call the office')).toBeTruthy();
  // No topic now means no lead sentence at all: the two rows below say it.
  expect(screen.queryByText(/Talk to the office/i)).toBeNull();
  // No topic means no prompts and no subtitle — the drawer's route is unchanged.
  expect(screen.getByText('Have these ready')).toBeTruthy();
  expect(screen.queryByText('Passenger issue')).toBeNull();
});

it('names the topic and prompts for what that call needs', async () => {
  const screen = await renderSupport('passenger');

  expect(await screen.findByText('Passenger issue')).toBeTruthy();
  expect(screen.getByText(/refused to pay/i)).toBeTruthy();
  // The specifics the office asks for, on screen before the driver dials.
  expect(screen.getByText('The trip number')).toBeTruthy();
  expect(screen.getByText('What the passenger did')).toBeTruthy();
  // And still the driver's own facts, in the same section.
  expect(screen.getByText('Alice Nakato')).toBeTruthy();
});

it('puts the topic in the mail subject and nothing in the body', async () => {
  const screen = await renderSupport('vehicle');

  await fireEvent.press(await screen.findByText('Email the office'));

  expect(Linking.openURL).toHaveBeenCalledWith(
    'mailto:office@example.test?subject=Vehicle%20issue',
  );
});

it('falls back to the plain screen when the topic key is not one we have', async () => {
  // A deep link from an older build. Answering a different question would be
  // worse than answering the general one.
  const screen = await renderSupport('passenger-issue');

  expect(await screen.findByText('Call the office')).toBeTruthy();
  expect(screen.queryByText('The trip number')).toBeNull();
});

it('offers no way to submit anything, because nothing on this platform receives it', async () => {
  const screen = await renderSupport('report');

  await screen.findByText('Report an issue');

  expect(JSON.stringify(screen.toJSON())).not.toContain('TextInput');
  expect(screen.queryByText(/^(Send|Submit)/i)).toBeNull();
});

it('says the office has published nothing rather than showing a plausible number', async () => {
  mockFetchOfficeContact.mockResolvedValue(office({ phone: null, email: null }));

  const screen = await renderSupport('payment');

  expect(await screen.findByText(/No number or address published yet/i)).toBeTruthy();
  expect(screen.queryByText('Call the office')).toBeNull();
  // The topic's prompts still help: the driver can ring the number they already
  // have with the right facts in hand.
  expect(screen.getByText(/Whether the passenger paid cash/i)).toBeTruthy();
});

it('renders an em dash for a profile fact it does not have', async () => {
  mockUseDriverProfile.mockReturnValue({ data: undefined });

  const screen = await renderSupport();

  await screen.findByText('Call the office');

  /*
    `docs/screen-rules.md` §1. A blank would read as "no name on file".

    **Counted, not `toBeGreaterThan(0)`.** Three of the four facts have their own
    fallback — name and phone dash, the vehicle says "No vehicle of your own",
    and the version is read from the manifest — so "at least one dash" stays
    true when any single one of them regresses. It did: the first version of
    this assertion survived `?? ''` on the name. Exactly two, so either one
    losing its dash bites.
  */
  expect(screen.getAllByText('—')).toHaveLength(2);
  expect(screen.getByText('No vehicle of your own')).toBeTruthy();
});
