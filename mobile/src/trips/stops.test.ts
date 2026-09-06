import type { TripStop } from '../api/types';
import { arrivedStop, inRunOrder, nextPendingStop } from './stops';

function stop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    id: 1,
    sequence: 1,
    label: 'Ntinda ATM',
    latitude: 0.3312,
    longitude: 32.5811,
    source: 'added_by_driver',
    status: 'pending',
    arrived_at: null,
    departed_at: null,
    skip_reason: null,
    client_place_id: null,
    kind: 'stop' as const,
    accepted_at: null,
    ...overrides,
  };
}

it('picks the first pending stop in run order, whatever order the array arrived in', function () {
  const stops = [
    stop({ id: 3, sequence: 3, label: 'Third' }),
    stop({ id: 2, sequence: 2, label: 'Second' }),
    stop({ id: 1, sequence: 1, label: 'First', status: 'done' }),
  ];

  expect(nextPendingStop(stops)?.label).toBe('Second');
});

it('answers null when the itinerary is empty or exhausted — the trip drop-off is the target again', function () {
  expect(nextPendingStop([])).toBeNull();
  expect(nextPendingStop([stop({ status: 'done' }), stop({ id: 2, sequence: 2, status: 'skipped' })])).toBeNull();
});

it('does not offer an arrived or skipped stop as the next destination', function () {
  // An arrived stop is where the vehicle *is*; a skipped one is §6's record
  // of a site not served. Neither is somewhere to navigate to.
  const stops = [
    stop({ id: 1, sequence: 1, status: 'arrived' }),
    stop({ id: 2, sequence: 2, label: 'Bugolobi branch' }),
  ];

  expect(nextPendingStop(stops)?.label).toBe('Bugolobi branch');
});

it('finds the stop the driver is standing at', function () {
  const here = stop({ id: 2, sequence: 2, status: 'arrived' });

  expect(arrivedStop([stop({ status: 'done' }), here])).toBe(here);
  expect(arrivedStop([stop()])).toBeNull();
});

it('restates run order without mutating the payload array', function () {
  const stops = [stop({ id: 2, sequence: 2 }), stop({ id: 1, sequence: 1 })];
  const ordered = inRunOrder(stops);

  expect(ordered.map((s) => s.id)).toEqual([1, 2]);
  // The trip payload is shared cache state; sorting it in place would
  // reorder it for every other reader of the same query.
  expect(stops.map((s) => s.id)).toEqual([2, 1]);
});
