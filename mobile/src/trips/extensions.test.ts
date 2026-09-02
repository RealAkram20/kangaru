import type { Trip, TripStop } from '../api/types';
import {
  addsExtension,
  canMarkDropoff,
  dropoffReached,
  extendLabel,
  extensionsOf,
  extensionsStillToRun,
  nextPlace,
  pendingRequest,
  stopsBeforeDropoff,
} from './extensions';

/**
 * The journey that grew past the drop-off it was agreed for.
 *
 * What is worth protecting here is the one distinction the whole feature
 * turns on: a **stop** is a pause and costs nothing, an **extension** moved
 * the end of the journey and is billed. Every function under test asks that
 * question first, and getting it wrong is invisible on screen — the label
 * looks right and the money is wrong.
 */

function stop(over: Partial<TripStop> = {}): TripStop {
  return {
    id: 1,
    sequence: 1,
    label: 'Ntinda ATM',
    latitude: null,
    longitude: null,
    kind: 'stop',
    source: 'added_by_driver',
    status: 'pending',
    arrived_at: null,
    departed_at: null,
    accepted_at: null,
    skip_reason: null,
    client_place_id: null,
    ...over,
  };
}

function trip(over: Partial<Trip> = {}): Trip {
  // Only the fields these helpers read. The screen's own tests mount the real
  // shape; this file is the judgement, not the payload.
  return {
    tenant_id: 12,
    dropoff_reached_at: null,
    stops: [],
    ...over,
  } as Trip;
}

it('tells an extension from a stop, whatever else they share', () => {
  const subject = trip({
    stops: [
      stop({ id: 1, kind: 'stop' }),
      stop({ id: 2, kind: 'extension' }),
    ],
  });

  expect(extensionsOf(subject).map((row) => row.id)).toEqual([2]);
});

it('finds the request a passenger is waiting on an answer for', () => {
  const subject = trip({
    stops: [
      stop({ id: 1, kind: 'extension', status: 'pending' }),
      stop({ id: 2, kind: 'extension', status: 'proposed' }),
    ],
  });

  expect(pendingRequest(subject)?.id).toBe(2);
});

it('does not mistake a plain stop for a request, however it is worded', () => {
  // A stop is never `proposed` — but if one ever were, answering it would put
  // an Accept button in front of a driver for something nobody asked them.
  const subject = trip({ stops: [stop({ status: 'proposed', kind: 'stop' })] });

  expect(pendingRequest(subject)).toBeNull();
});

it('counts only the extensions still to be driven', () => {
  const subject = trip({
    stops: [
      stop({ id: 1, kind: 'extension', status: 'pending' }),
      stop({ id: 2, kind: 'extension', status: 'arrived' }),
      // Neither of these is the trip's commitment: one was never agreed, one
      // was answered, one is finished.
      stop({ id: 3, kind: 'extension', status: 'proposed' }),
      stop({ id: 4, kind: 'extension', status: 'skipped' }),
      stop({ id: 5, kind: 'extension', status: 'done' }),
      stop({ id: 6, kind: 'stop', status: 'pending' }),
    ],
  });

  expect(extensionsStillToRun(subject).map((row) => row.id)).toEqual([1, 2]);
});

it('reads the drop-off boundary off the trip', () => {
  expect(dropoffReached(trip())).toBe(false);
  expect(canMarkDropoff(trip())).toBe(true);

  const marked = trip({ dropoff_reached_at: '2026-08-28T09:00:00+00:00' });

  expect(dropoffReached(marked)).toBe(true);
  // The act is idempotent on the server, so offering it again would be a
  // button that visibly does nothing.
  expect(canMarkDropoff(marked)).toBe(false);
});

it('bills a walk-in passenger who goes further, and says so on the button', () => {
  const walkIn = trip({ tenant_id: null });

  expect(addsExtension(walkIn)).toBe(true);
  expect(extendLabel(walkIn)).toBe('Extend the trip');
});

it("leaves a corporate circuit's stops unbilled, and keeps its own word", () => {
  // ADR-0045 §4: the bank's five ATMs are an itinerary, recorded and shown,
  // never billed. Turning those into extensions would start charging a client
  // for the route they contracted.
  const circuit = trip({ tenant_id: 12 });

  expect(addsExtension(circuit)).toBe(false);
  expect(extendLabel(circuit)).toBe('Add a drop-off');
});

/*
  **The journey has two halves, and this is the seam.**

  Stops happen on the way to the agreed drop-off; extensions happen after it.
  They share one list ordered by `sequence`, so nothing in the data says which
  side a row is on — and the app got it wrong in three places at once until
  this existed: the route list, the "next drop-off" row and the map pin all
  aimed at an extension while the destination the passenger was hired for was
  still ahead.

  Found by rendering the screen on a handset. No test caught it because no
  fixture had an extension on a trip that still had its drop-off to reach.
*/

it('keeps the agreed drop-off next until it has been reached', () => {
  const subject = trip({
    stops: [stop({ id: 1, kind: 'extension', status: 'pending' })],
  });

  // Null means "the drop-off itself", which is what the screen renders when
  // there is nowhere else to be.
  expect(nextPlace(subject)).toBeNull();
});

it('sends the driver on to the extension once the drop-off is marked', () => {
  const subject = trip({
    dropoff_reached_at: '2026-08-28T09:00:00+00:00',
    stops: [stop({ id: 1, kind: 'extension', status: 'pending' })],
  });

  expect(nextPlace(subject)?.id).toBe(1);
});

it('still visits the circuit stops first, drop-off or no drop-off', () => {
  // A corporate run is unaffected by any of this: its stops come before the
  // destination, exactly as ADR-0045 §4 always meant.
  const subject = trip({
    stops: [
      stop({ id: 1, kind: 'stop', status: 'pending' }),
      stop({ id: 2, kind: 'extension', status: 'pending' }),
    ],
  });

  expect(nextPlace(subject)?.id).toBe(1);
  expect(stopsBeforeDropoff(subject).map((row) => row.id)).toEqual([1]);
});
