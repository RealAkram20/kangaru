import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '../api/errors';
import type { PlaceSuggestion, Trip, TripStopCandidate } from '../api/types';
import { AddDropoffScreen } from './AddDropoffScreen';

/**
 * The add-a-drop-off search (ADR-0045 §4, §10): that a saved-place pick sends
 * the id alone, that free text stays available whatever the register answers,
 * and that a refusal is shown here rather than swallowed.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockAddTripStop = jest.fn(async () => ({}));
const mockAddTripExtension = jest.fn(async () => ({}));
const mockUseTrip = jest.fn();
const mockUseCandidates = jest.fn();
const mockUseSuggestions = jest.fn();
const mockInvalidate = jest.fn(async () => undefined);

jest.mock('../api/endpoints', () => ({
  addTripStop: (...args: unknown[]) => mockAddTripStop(...(args as [])),
  addTripExtension: (...args: unknown[]) => mockAddTripExtension(...(args as [])),
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ api: {} }),
}));

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  // All three arguments forwarded, `enabled` included: it is the field that
  // decides whether a walk-in trip asks at all, and a mock that swallowed it
  // would make that assertion vacuous.
  useTripStopCandidates: (id: number, q: string, enabled?: boolean) =>
    mockUseCandidates(id, q, enabled),
  usePlaceSuggestions: (id: number, q: string) => mockUseSuggestions(id, q),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

const PLACES: TripStopCandidate[] = [
  { id: 11, name: 'Ntinda ATM', address: 'Ntinda Rd, Kampala', latitude: 0.3312, longitude: 32.5811 },
  { id: 12, name: 'Ntinda branch', address: null, latitude: 0.3318, longitude: 32.582 },
];

function corporateTrip(): Partial<Trip> {
  return {
    id: 42,
    tenant_id: 7,
    dropoff: { label: 'Head Office', latitude: null, longitude: null },
  };
}

const navigate = jest.fn();
const goBack = jest.fn();

async function renderAdd(
  trip: Partial<Trip> | undefined = corporateTrip(),
  candidates: { data?: TripStopCandidate[]; isError?: boolean; isSuccess?: boolean } = {
    data: PLACES,
    isSuccess: true,
  },
  suggestions: { data?: PlaceSuggestion[] } = { data: [] },
): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data: trip });
  mockUseCandidates.mockReturnValue({
    data: candidates.data,
    isError: candidates.isError ?? false,
    isSuccess: candidates.isSuccess ?? false,
    isLoading: false,
  });
  mockUseSuggestions.mockReturnValue({ data: suggestions.data });

  const node: ReactElement = (
    <AddDropoffScreen
      route={{ key: 'a', name: 'AddDropoff', params: { tripId: 42 } }}
      navigation={{ navigate, goBack } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  navigate.mockClear();
  goBack.mockClear();
  mockAddTripStop.mockClear();
  mockAddTripExtension.mockClear();
  mockAddTripExtension.mockResolvedValue({});
  mockAddTripStop.mockResolvedValue({});
  mockInvalidate.mockClear();
});

it('sends a saved-place pick as the id alone, so this handset cannot mislabel an ATM', async () => {
  const { getByLabelText } = await renderAdd();

  void fireEvent.press(getByLabelText('Add Ntinda ATM as the next drop-off'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(mockAddTripStop).toHaveBeenCalledWith({}, 42, { clientPlaceId: 11 });
  // The trip payload carries the itinerary and the route now targets the new
  // stop — the invalidation is what makes the in-progress screen move.
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['trips', 42] });
});

it('offers what was typed as a label-only stop, and says it has no pin', async () => {
  const { getByPlaceholderText, getByText, getByLabelText } = await renderAdd();

  await fireEvent.changeText(getByPlaceholderText('Search saved places, or type it'), 'Kireka kiosk');

  expect(getByText('As typed — no map pin')).toBeTruthy();

  void fireEvent.press(getByLabelText('Add Kireka kiosk as the next drop-off'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(mockAddTripStop).toHaveBeenCalledWith({}, 42, { label: 'Kireka kiosk' });
});

it('shows the office\'s own refusal and stays on the screen', async () => {
  mockAddTripStop.mockRejectedValue(
    new ApiError({
      code: 'TRIP_NOT_ACTIVE',
      message: 'Stops can only be added while the trip is running.',
      status: 409,
    }),
  );

  const { getByLabelText, findByText } = await renderAdd();

  void fireEvent.press(getByLabelText('Add Ntinda ATM as the next drop-off'));

  expect(await findByText('Stops can only be added while the trip is running.')).toBeTruthy();
  expect(goBack).not.toHaveBeenCalled();
});

it('keeps the free-text row working when the register is unreachable', async () => {
  const { getByPlaceholderText, getByText } = await renderAdd(corporateTrip(), {
    isError: true,
  });

  await fireEvent.changeText(getByPlaceholderText('Search saved places, or type it'), 'Ntinda');

  expect(
    getByText('Saved places are unreachable right now. You can still add what you typed.'),
  ).toBeTruthy();
  expect(getByText('Add “Ntinda”')).toBeTruthy();
});

it('does not search at all for a walk-in trip, which has no register', async () => {
  // The third argument is `enabled`: a walk-in has no tenant and therefore no
  // saved places, so the question is never asked (ADR-0045 §10).
  const { getByPlaceholderText } = await renderAdd(
    {
      id: 42,
      tenant_id: null,
      dropoff: { label: 'Wandegeya', latitude: null, longitude: null },
    },
    { data: [], isSuccess: true },
  );

  await fireEvent.changeText(getByPlaceholderText('Type the next drop-off'), 'Ntinda');

  expect(mockUseCandidates).toHaveBeenLastCalledWith(42, 'Ntinda', false);
});

it('shows the client\'s estate the moment the screen opens, so the bank case is one tap', async () => {
  // The owner's flow: five ATMs, one driver, one at a time. Making them type
  // before seeing their own sites is a keyboard in a cradle for a list of
  // twelve the server sends whole anyway. Found by rendering the screen.
  const { getByText, getByLabelText } = await renderAdd();

  expect(mockUseCandidates).toHaveBeenLastCalledWith(42, '', true);
  expect(getByText('Saved places')).toBeTruthy();
  expect(getByLabelText('Add Ntinda ATM as the next drop-off')).toBeTruthy();
});

it('asks for something rather than showing an empty page under a search box', async () => {
  const { getByText } = await renderAdd(corporateTrip(), { data: [], isSuccess: true });

  expect(getByText('Type where you are going next.')).toBeTruthy();
});

it('says plainly when nothing in the register matches', async () => {
  const { getByPlaceholderText, getByText } = await renderAdd(corporateTrip(), {
    data: [],
    isSuccess: true,
  });

  await fireEvent.changeText(getByPlaceholderText('Search saved places, or type it'), 'Jinja');

  expect(getByText('No saved place matches.')).toBeTruthy();
  // And the way forward is still one tap.
  expect(getByText('Add “Jinja”')).toBeTruthy();
});

/**
 * The §10 follow-up (owner decision, 2026-08-22): a geocoder answers under
 * the register, and a taken suggestion carries its pin so the map and the
 * day's record know where the run went.
 */
it('sends a suggestion as its label and pin together', async () => {
  const { getByLabelText, getByText } = await renderAdd(corporateTrip(), { data: [], isSuccess: true }, {
    data: [{ name: 'Acacia Mall', detail: 'Kololo, Kampala', latitude: 0.3341, longitude: 32.5946 }],
  });

  expect(getByText('Suggestions')).toBeTruthy();
  expect(getByText('Kololo, Kampala')).toBeTruthy();

  void fireEvent.press(getByLabelText('Add Acacia Mall as the next drop-off'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(mockAddTripStop).toHaveBeenCalledWith({}, 42, {
    label: 'Acacia Mall',
    latitude: 0.3341,
    longitude: 32.5946,
  });
});

it('asks the geocoder on a walk-in trip, which is exactly the unpinned case', async () => {
  await renderAdd(
    {
      id: 42,
      tenant_id: null,
      dropoff: { label: 'Wandegeya', latitude: null, longitude: null },
    },
    { data: [], isSuccess: true },
    { data: [] },
  );

  expect(mockUseSuggestions).toHaveBeenLastCalledWith(42, '');
});

it('shows no Suggestions heading when the geocoder has nothing', async () => {
  const { queryByText } = await renderAdd();

  expect(queryByText('Suggestions')).toBeNull();
});

/*
  **Which of the two this screen sends, and why it is the whole point.**

  Before 2026-08-28 it always appended a stop, and ADR-0045 §4 is explicit
  that a stop is never billed. On a walk-in that was a live defect rather
  than a missing feature: a passenger asking to be carried further produced
  kilometres the reference route never drew, which `ROUTE_CAPPED` then capped
  away — driven, and not paid for. The owner was shown the collision and
  chose that a walk-in's mid-run place is an extension.

  A corporate circuit is untouched. Its five ATMs are the route the client
  contracted, and turning those into extensions would start charging for
  them.
*/

it('bills a walk-in passenger who asks to go further', async () => {
  const { getByPlaceholderText, getByLabelText } = await renderAdd(
    {
      id: 42,
      tenant_id: null,
      dropoff: { label: 'Wandegeya', latitude: null, longitude: null },
    },
    { data: [], isSuccess: true },
  );

  await fireEvent.changeText(getByPlaceholderText('Type the next drop-off'), 'Kabalagala');
  void fireEvent.press(getByLabelText('Add Kabalagala as the next drop-off'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(mockAddTripExtension).toHaveBeenCalledWith({}, 42, { label: 'Kabalagala' });
  expect(mockAddTripStop).not.toHaveBeenCalled();
});

it("leaves a corporate circuit's stops unbilled", async () => {
  const { getByLabelText } = await renderAdd();

  void fireEvent.press(getByLabelText('Add Ntinda ATM as the next drop-off'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(mockAddTripStop).toHaveBeenCalled();
  expect(mockAddTripExtension).not.toHaveBeenCalled();
});

/*
  **The toggle, which is the half an inference cannot do** (owner, 2026-08-28).

  The trip kind gives the right default almost every time, and "almost" is the
  problem: a walk-in passenger sometimes asks the car to wait somewhere on the
  way, and a corporate driver sometimes genuinely carries somebody past the
  contracted route. Only the person in the car knows, and getting it wrong is
  money in both directions — an unbilled extension the driver covers, or a
  client charged for a stop they contracted.
*/

it('lets the driver bill a corporate trip they really did extend', async () => {
  const { getByLabelText } = await renderAdd();

  // Defaulted to a stop, because it is a circuit — then corrected.
  await fireEvent.press(getByLabelText('Extension'));
  void fireEvent.press(getByLabelText('Add Ntinda ATM as the next drop-off'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(mockAddTripExtension).toHaveBeenCalled();
  expect(mockAddTripStop).not.toHaveBeenCalled();
});

it('lets the driver record an unbilled pause on a walk-in', async () => {
  const { getByPlaceholderText, getByLabelText } = await renderAdd(
    {
      id: 42,
      tenant_id: null,
      dropoff: { label: 'Wandegeya', latitude: null, longitude: null },
    },
    { data: [], isSuccess: true },
  );

  // Defaulted to an extension, because it is a walk-in — then corrected.
  await fireEvent.press(getByLabelText('Drop-off'));

  await fireEvent.changeText(getByPlaceholderText('Type the next drop-off'), 'Chemist');
  void fireEvent.press(getByLabelText('Add Chemist as the next drop-off'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(mockAddTripStop).toHaveBeenCalledWith({}, 42, { label: 'Chemist' });
  expect(mockAddTripExtension).not.toHaveBeenCalled();
});
