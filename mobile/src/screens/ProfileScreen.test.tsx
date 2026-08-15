import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverProfile, DriverStats } from '../api/endpoints';
import { ProfileScreen } from './ProfileScreen';

/**
 * That the profile screen mounts, and shows only what the platform holds.
 *
 * `profile/presentation.test.ts` owns the wording. This suite exists because
 * that one does not prove the screen renders, and because the refusals below
 * would otherwise live only in a docblock:
 *
 * - **No photograph.** There is no avatar at any layer; a monogram derived
 *   from the driver's own name is a fact, a stock face is not.
 * - **No "Bank Details".** No bank rail exists and ADR-0029 §6 rules one out
 *   by name.
 * - **No bare rating.** ADR-0030 §3 withholds a score below five ratings, and
 *   this screen must not reintroduce one.
 * - **The parked queue is still reachable**, which ADR-0023 §6 requires and
 *   which a menu-shaped redesign is exactly how you lose.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockUseDriverProfile = jest.fn();
const mockUseDriverStats = jest.fn();
const mockUseSync = jest.fn();

jest.mock('../profile/queries', () => ({
  useDriverProfile: () => mockUseDriverProfile(),
}));

jest.mock('../trips/queries', () => ({
  useDriverStats: () => mockUseDriverStats(),
}));

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => mockUseSync(),
}));

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { name: 'Account Name' }, signOut: jest.fn() }),
}));

function profile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    name: 'John Kamau',
    phone: '+256700123456',
    email: null,
    member_since: '2024-01-15',
    trips_total: 428,
    vehicle: {
      make: 'Toyota',
      model: 'Wish',
      registration_number: 'UBB 123X',
      category: 'sedan',
      category_label: 'Sedan',
    },
    documents: { state: 'verified', verified: 4, total: 4, action_needed: 0, pending: 0 },
    ...overrides,
  };
}

function stats(overrides: Partial<DriverStats> = {}): DriverStats {
  return {
    trips_today: 2,
    earnings_today_minor: 16_400,
    wallet_balance_minor: -4_500,
    currency: 'UGX',
    acceptance_rate: 92,
    completion_rate: 100,
    rating: 4.8,
    rating_count: 6,
    window_days: 30,
    ...overrides,
  };
}

const navigation = {
  navigate: jest.fn(),
  getParent: () => ({ navigate: jest.fn() }),
} as never;

async function renderProfile(element: ReactElement) {
  // RTL v14's render is async in this setup; awaiting is what makes the tree
  // exist rather than the screen appearing broken.
  return render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
}

beforeEach(() => {
  mockUseDriverProfile.mockReturnValue({ data: profile() });
  mockUseDriverStats.mockReturnValue({ data: stats() });
  mockUseSync.mockReturnValue({ parked: [], pending: 0 });
});

it('shows who the driver is, and what they drive', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('John Kamau')).toBeTruthy();
  expect(screen.getByText('+256700123456')).toBeTruthy();
  expect(screen.getByText('Toyota Wish · UBB 123X')).toBeTruthy();
  expect(screen.getByText('Sedan')).toBeTruthy();
  expect(screen.getByText('Jan 2024')).toBeTruthy();
  expect(screen.getByText('4.8')).toBeTruthy();
});

it('draws a monogram where the mockup drew a photograph', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  // Derived from the driver's own name. There is no avatar at any layer on
  // this platform, and a stock face misidentifies the person.
  //
  // `includeHiddenElements` is the assertion, not a workaround: the monogram
  // is deliberately hidden from a screen reader, because the name it is built
  // from is read out immediately beside it and "JK, John Kamau" is the same
  // fact twice. Finding it without the flag would mean that had regressed.
  expect(screen.getByText('JK', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByText('JK')).toBeNull();
});

it('withholds the rating below five, rather than printing one', async () => {
  mockUseDriverStats.mockReturnValue({ data: stats({ rating: null, rating_count: 2 }) });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('—')).toBeTruthy();
  // The count is what makes the dash legible — a bare dash invites a driver to
  // assume the worst about a number that can end their income.
  expect(screen.getByText(/2 ratings so far/)).toBeTruthy();
});

it('never offers bank details, which nothing on this platform can do', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.queryByText(/Bank/i)).toBeNull();
  // The honest neighbour: settling up is a request the office answers
  // (ADR-0032), and it lives on the Wallet tab.
  expect(screen.getByText('Settling up')).toBeTruthy();
});

it('keeps the parked queue reachable, and says when nothing is stuck', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Updates & sync')).toBeTruthy();
  expect(screen.getByText('Nothing stuck')).toBeTruthy();
});

it('counts what is stuck, so a refused update cannot be missed', async () => {
  // ADR-0023 §6. A driver whose closing odometer was refused has to be able to
  // read the number back to the office, which means the row has to shout.
  mockUseSync.mockReturnValue({ parked: [{ id: 'a' }, { id: 'b' }], pending: 2 });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('2 need you')).toBeTruthy();
});

it('gives time off a way in, which the four-tab bar had left unreachable', async () => {
  // `TimeOff` was registered on this stack with nothing navigating to it: it
  // lost its tab and never gained a row.
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Time off')).toBeTruthy();
});

it('reports the documents state rather than assuming the friendly one', async () => {
  mockUseDriverProfile.mockReturnValue({
    data: profile({
      documents: { state: 'action_needed', verified: 2, total: 4, action_needed: 1, pending: 1 },
    }),
  });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('1 needs attention')).toBeTruthy();
  expect(screen.queryByText('Verified')).toBeNull();
});

it('renders em dashes rather than blanks before the profile loads', async () => {
  mockUseDriverProfile.mockReturnValue({ data: undefined });
  mockUseDriverStats.mockReturnValue({ data: undefined });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  // The account's name still stands in — a driver knows their own name even
  // when their driver record has not arrived.
  expect(screen.getByText('Account Name')).toBeTruthy();
  expect(screen.getAllByText('—').length).toBeGreaterThan(1);
});
