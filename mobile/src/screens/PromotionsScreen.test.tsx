import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverPromotions } from '../api/endpoints';
import { PromotionsScreen } from './PromotionsScreen';

/**
 * The Promotions screen (ADR-0036, ADR-0037).
 *
 * The cases that matter are all one property: **a scheme that is off draws
 * nothing.** `docs/screen-rules.md` §1 refuses a zero standing in for a figure
 * that does not exist, and this screen has three chances to break that rule —
 * a "0 of 40 trips" bar, an "Earn 0% more" card, and a referral code for a
 * scheme that pays nothing.
 *
 * The rest is about the two sentences the mockup does not have and this screen
 * must: that the bonus is paid only after the week closes, and that the peak
 * uplift is on the driver's own share.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockUseDriverPromotions = jest.fn();

jest.mock('../promotions/queries', () => ({
  useDriverPromotions: () => mockUseDriverPromotions(),
}));

const EVERYTHING: DriverPromotions = {
  currency: 'UGX',
  timezone: 'Africa/Kampala',
  weeklyChallenge: {
    trips: 18,
    tripTarget: 30,
    amountMinor: 50_000,
    currency: 'UGX',
    weekStart: '2026-08-10T00:00:00+03:00',
    endsAt: '2026-08-17T00:00:00+03:00',
    achieved: false,
  },
  peakHours: {
    startsAt: '2026-08-14T17:00:00+03:00',
    endsAt: '2026-08-14T20:00:00+03:00',
    active: false,
    upliftPercent: 20,
  },
  referral: {
    code: 'K7MTQ4RB',
    tripTarget: 10,
    rewardAmountMinor: 10_000,
    introduced: 0,
    qualified: 0,
    earnedMinor: 0,
  },
};

const goBack = jest.fn();

async function renderPromotions(
  data: DriverPromotions | undefined = EVERYTHING,
  state: { isLoading?: boolean; isError?: boolean } = {},
): Promise<ReturnType<typeof render>> {
  mockUseDriverPromotions.mockReturnValue({
    data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  });

  const node: ReactElement = (
    <PromotionsScreen
      route={{ key: 'p', name: 'Promotions', params: undefined }}
      navigation={{ goBack, navigate: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  goBack.mockClear();
  mockUseDriverPromotions.mockClear();
  jest.useFakeTimers();
  // Friday 14 August 2026, 14:00 Kampala — inside the challenge week, before
  // that evening's peak window opens.
  jest.setSystemTime(new Date('2026-08-14T11:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

// -- The three cards -------------------------------------------------------

it('draws the weekly challenge with the figures the server computed', async () => {
  const screen = await renderPromotions();

  expect(screen.getByText('Weekly Challenge')).toBeTruthy();
  expect(screen.getByText('Complete 30 trips.')).toBeTruthy();
  // "UGX 50,000 Bonus", as the mockup writes it — the trailing word names the
  // wallet credit kind this will arrive as, so a driver can find it later.
  expect(screen.getByText('UGX 50,000 Bonus')).toBeTruthy();
  // The count is one Text with a bolder span inside it, so it composes to a
  // single node — which is also how a screen reader will hear it.
  expect(screen.getByText('18 / 30 trips')).toBeTruthy();
  expect(screen.getByText('Ends in 3 days')).toBeTruthy();
});

it('says the bonus arrives only after the week closes', async () => {
  const screen = await renderPromotions();

  // The one sentence the mockup does not have. Without it the card is a
  // promise: a driver at 30 of 30 on Wednesday has cleared the target and
  // still has nothing until Monday (ADR-0034 §4).
  expect(screen.getByText(/after the week closes/)).toBeTruthy();
});

it('draws the peak window in the fleet zone, with what it applies to', async () => {
  const screen = await renderPromotions();

  expect(screen.getByText('Peak Hours')).toBeTruthy();
  expect(screen.getByText('Earn 20% more')).toBeTruthy();
  // The mockup's "Today," is kept, and it is *checked* rather than assumed —
  // this card caches for five minutes and survives being backgrounded.
  expect(screen.getByText('Today, 5:00 PM – 8:00 PM')).toBeTruthy();
  // "Earn 20% more" alone could be read as 20% off a bigger fare, which is
  // what the *night rate* does and is a different thing that also exists.
  expect(screen.getByText(/your share of every trip/)).toBeTruthy();
});

it('says nothing about running now while the window is shut', async () => {
  const screen = await renderPromotions();

  expect(screen.queryByText('Running now')).toBeNull();
});

it('marks the window live inside it, with a word and not just a colour', async () => {
  // 18:30 Kampala.
  jest.setSystemTime(new Date('2026-08-14T15:30:00Z'));

  const screen = await renderPromotions();

  // A coloured dot on its own is invisible to a screen reader and ambiguous
  // in direct sun, which is where this app is read (`screen-rules` §6).
  expect(screen.getByText('Running now')).toBeTruthy();
});

it('draws the referral offer and the code', async () => {
  const screen = await renderPromotions();

  expect(screen.getByText('Refer a Friend')).toBeTruthy();
  expect(screen.getByText('Earn UGX 10,000')).toBeTruthy();
  expect(screen.getByText('when they complete 10 trips')).toBeTruthy();
  expect(screen.getByText('K7MTQ4RB')).toBeTruthy();
});

it('shares the code rather than copying it, and promises the friend nothing', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);

  const screen = await renderPromotions();

  await fireEvent.press(screen.getByLabelText(/Share your referral code/));

  expect(share).toHaveBeenCalledWith({
    message: 'Drive with KangaruRide. Use my referral code K7MTQ4RB when you apply.',
  });

  share.mockRestore();
});

it('spells the code out for a screen reader', async () => {
  const screen = await renderPromotions();

  // Read as a word, "K7MTQ4RB" is noise — and saying it to somebody else is
  // the only thing a driver does with it.
  expect(screen.getByLabelText('Share your referral code, K 7 M T Q 4 R B')).toBeTruthy();
});

// -- Schemes that are off --------------------------------------------------

it('draws no challenge card at all when the bonus scheme is off', async () => {
  const screen = await renderPromotions({ ...EVERYTHING, weeklyChallenge: null });

  expect(screen.queryByText('Weekly Challenge')).toBeNull();
  // And emphatically not a zeroed one. "0 / 40 trips" on a fleet running no
  // bonus scheme is an invented figure dressed as a measurement.
  expect(screen.queryByText(/\d+ \/ \d+ trips/)).toBeNull();
  expect(screen.queryByText(/after the week closes/)).toBeNull();
  // The other two are untouched.
  expect(screen.getByText('Peak Hours')).toBeTruthy();
});

it('draws no peak card when the scheme is off', async () => {
  const screen = await renderPromotions({ ...EVERYTHING, peakHours: null });

  expect(screen.queryByText('Peak Hours')).toBeNull();
  expect(screen.queryByText(/Earn 0% more/)).toBeNull();
  expect(screen.getByText('Weekly Challenge')).toBeTruthy();
});

it('draws no referral card when the scheme is off', async () => {
  const screen = await renderPromotions({ ...EVERYTHING, referral: null });

  expect(screen.queryByText('Refer a Friend')).toBeNull();
  // A code for a scheme that pays nothing is worse than no code: somebody
  // would give it to a friend.
  expect(screen.queryByText('K7MTQ4RB')).toBeNull();
});

it('says so plainly when nothing is running at all', async () => {
  const screen = await renderPromotions({
    currency: 'UGX',
    timezone: 'Africa/Kampala',
    weeklyChallenge: null,
    peakHours: null,
    referral: null,
  });

  expect(screen.getByText(/No promotions running/)).toBeTruthy();
});

// -- Load and failure ------------------------------------------------------

it('says nothing is running only once it knows, never while loading', async () => {
  const screen = await renderPromotions(undefined, { isLoading: true });

  // An empty state shown during a load tells a driver there are no promotions
  // when the truthful answer is "not yet known".
  expect(screen.queryByText(/no promotions running/)).toBeNull();
});

it('explains a failed load rather than showing an empty screen', async () => {
  const screen = await renderPromotions(undefined, { isError: true });

  expect(screen.getByText(/Could not load/)).toBeTruthy();
  expect(screen.queryByText(/no promotions running/)).toBeNull();
});

// -- Navigation ------------------------------------------------------------

it('goes back to the profile it was opened from', async () => {
  const screen = await renderPromotions();

  await fireEvent.press(screen.getByLabelText('Back'));

  expect(goBack).toHaveBeenCalled();
});
