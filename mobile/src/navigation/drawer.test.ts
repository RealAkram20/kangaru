import type { Trip, TripStatus } from '../api/types';
import { drawerSections, liveTripRow, selectedRowKey } from './drawer';

/**
 * The drawer's row list, as data.
 *
 * The two things here that can be quietly wrong are which screen a row opens
 * and whether a row should be there at all — neither is visible in a snapshot,
 * and the second is the one that puts a menu entry in front of a driver that
 * goes nowhere useful.
 */

function trip(status: TripStatus, id = 41): Trip {
  // Only the two fields these functions read. The full fixture lives in the
  // suites that render a trip; widening it here would mean this file needed
  // patching every time somebody adds a required column.
  return { id, status } as Trip;
}

const rows = (liveTrip = null as ReturnType<typeof liveTripRow>, unread: number | null = null) =>
  drawerSections(liveTrip, unread).flatMap((section) => section.rows);

// -- The live trip row -----------------------------------------------------

describe('the live trip row', () => {
  it('is absent when no trip is running', () => {
    // The mockup's "Trip Details" as a permanent row could not work: a trip
    // screen needs an id, and opening whichever journey happened to be most
    // recent is a guess presented as navigation.
    expect(liveTripRow([])).toBeNull();
    expect(liveTripRow(undefined)).toBeNull();
    expect(rows().some((row) => row.key === 'live-trip')).toBe(false);
  });

  it('is absent for a trip that has finished', () => {
    expect(liveTripRow([trip('trip_completed')])).toBeNull();
  });

  it('names what the trip is doing rather than saying "Trip Details"', () => {
    // `statusLabel` is the one place a status is put into words for a driver,
    // so the drawer and the screen it opens agree.
    expect(liveTripRow([trip('driver_en_route')])?.label).toBe('On the way');
  });

  it('routes through tripDestination, so a live trip never opens the record view', () => {
    // Hardcoding `TripDetail` here would reopen the bug the worklog records
    // somebody already fixing once: the record view appearing mid-trip.
    const row = liveTripRow([trip('trip_started', 77)]);

    expect(row?.destination.tab).toBe('Home');
    expect(row?.destination.screen).toBe('TripInProgress');
    expect(row?.destination.params).toEqual({ tripId: 77 });
  });

  it('sends a passenger-onboard trip to the odometer, with the transition it needs', () => {
    const row = liveTripRow([trip('passenger_onboard', 12)]);

    expect(row?.destination.screen).toBe('Odometer');
    expect(row?.destination.params).toEqual({
      tripId: 12,
      to: 'trip_started',
      from: 'passenger_onboard',
    });
  });

  it('sits directly under Home, where a driver mid-shift looks first', () => {
    const list = rows(liveTripRow([trip('trip_started')]));

    expect(list[0]?.key).toBe('home');
    expect(list[1]?.key).toBe('live-trip');
  });
});

// -- The sections ----------------------------------------------------------

describe('the two lists', () => {
  it('puts the work and the money above the rule, and the account below it', () => {
    // Ordering by frequency is what makes a thirteen-row menu scannable from
    // a cradle. Above: what a driver opens during a shift. Below: what they
    // open once a month.
    const [work, account] = drawerSections(null, null);

    expect(work?.rows.map((row) => row.key)).toEqual([
      'home',
      'trips-history',
      'earnings',
      'wallet',
      'promotions',
      'performance',
      'notifications',
    ]);

    expect(account?.rows.map((row) => row.key)).toEqual([
      'profile',
      'documents',
      'settings',
      'safety',
      'support',
    ]);
  });

  it('carries every row the Profile screen gave up', () => {
    // The owner's "we don't need to repeat the menus" only holds if the drawer
    // actually took them. Documents and Performance were the ADR-0033 and
    // ADR-0038 agents'; losing either in the move would be silent.
    const keys = rows().map((row) => row.key);

    for (const moved of ['documents', 'performance', 'promotions', 'trips-history']) {
      expect(keys).toContain(moved);
    }
  });

  it('sends the four new screens to the Profile stack, so they keep the tab bar', () => {
    const list = rows();

    for (const key of ['notifications', 'settings', 'safety', 'support']) {
      const row = list.find((candidate) => candidate.key === key);

      expect(row?.destination.tab).toBe('Profile');
      expect(row?.destination.screen).toBeDefined();
    }
  });

  /*
   * **Inverted after a device run, not deleted.** The original asserted the
   * four tab rows named no screen, "so each resumes where it was" — and the
   * owner found the failure that reasoning hides: stand on Settings (inside
   * the Profile stack), tap the drawer's Profile row, and "resume" means
   * nothing happens. A menu row that does nothing is a dead control. Every
   * row now names its stack root.
   */
  it('sends every tab row to its stack root, so tapping it always goes somewhere', () => {
    const roots: Record<string, string> = {
      home: 'TripsHome',
      earnings: 'EarningsHome',
      wallet: 'WalletHome',
      profile: 'ProfileHome',
    };
    const list = rows();

    for (const [key, root] of Object.entries(roots)) {
      expect(list.find((row) => row.key === key)?.destination.screen).toBe(root);
    }
  });
});

// -- The unread badge ------------------------------------------------------

describe('the notifications badge', () => {
  it('carries the count when there is one', () => {
    expect(rows(null, 3).find((row) => row.key === 'notifications')?.badge).toBe(3);
  });

  it('carries null while the count is unknown, which draws no dot', () => {
    // Null and zero must not look the same: a drawer drawing no dot because
    // the count had not loaded is indistinguishable from one drawing none
    // because there is nothing to read, and only the first is temporary.
    expect(rows(null, null).find((row) => row.key === 'notifications')?.badge).toBeNull();
  });
});

// -- Which row is lit ------------------------------------------------------

describe('the selected row', () => {
  it('lights the tab root a driver is on', () => {
    expect(selectedRowKey(drawerSections(null, null), 'Wallet', 'WalletHome')).toBe('wallet');
  });

  it('lights the nested screen rather than its tab', () => {
    // Four rows below the rule live inside the Profile tab. Lighting "Profile"
    // while a driver reads Settings would tell them they are somewhere they
    // are not, on the one control whose whole job is saying where they are.
    expect(selectedRowKey(drawerSections(null, null), 'Profile', 'Settings')).toBe('settings');
    expect(selectedRowKey(drawerSections(null, null), 'Profile', 'ProfileHome')).toBe('profile');
  });

  it('lights nothing rather than defaulting to Home', () => {
    // A driver on the Odometer modal or a live-leg screen is on none of these,
    // and lighting Home would be a claim rather than a default. (Before the
    // tab rows named their roots, 'Home'/'Odometer' lit Home through the
    // tab-only fallback; the stricter answer is the honest one.)
    expect(selectedRowKey(drawerSections(null, null), 'Home', 'Odometer')).toBeNull();
    expect(selectedRowKey(drawerSections(null, null), undefined, undefined)).toBeNull();
  });
});
