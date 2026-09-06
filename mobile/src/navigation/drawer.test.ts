import { drawerSections, selectedRowKey } from './drawer';

/**
 * The drawer's row list, as data.
 *
 * The two things here that can be quietly wrong are which screen a row opens
 * and whether a row should be there at all — neither is visible in a snapshot,
 * and the second is the one that puts a menu entry in front of a driver that
 * goes nowhere useful.
 */

const rows = (unread: number | null = null) =>
  drawerSections(unread).flatMap((section) => section.rows);

// -- The live trip row, which is deliberately gone -------------------------

describe('the live trip row', () => {
  it('does not exist, in any trip state', () => {
    // It was labelled `statusLabel(live.status)`, so a driver mid-capture read
    // **"Passenger on board"** in their menu — a lifecycle state name offered
    // as a destination. The owner asked what it was for and removed it:
    // `HomeScreen`'s `ActiveTripCard` already opens the live trip in one tap,
    // from the very screen this drawer is opened over.
    //
    // Asserted as an absence over the whole list rather than trusted to the
    // deleted export, because the failure this guards is a *row reappearing* —
    // which a test that only checks `liveTripRow` is gone would not see.
    expect(rows().some((row) => row.key === 'live-trip')).toBe(false);
    expect(rows().some((row) => row.label === 'Passenger on board')).toBe(false);
  });

  it('leaves Trips History directly under Home', () => {
    // The row sat between them. Its removal must close the gap rather than
    // leave the work list starting with a hole.
    const list = rows();

    expect(list[0]?.key).toBe('home');
    expect(list[1]?.key).toBe('trips-history');
  });
});

// -- The sections ----------------------------------------------------------

describe('the two lists', () => {
  it('puts the work and the money above the rule, and the account below it', () => {
    // Ordering by frequency is what makes a thirteen-row menu scannable from
    // a cradle. Above: what a driver opens during a shift. Below: what they
    // open once a month.
    const [work, account] = drawerSections(null);

    expect(work?.rows.map((row) => row.key)).toEqual([
      'home',
      'trips-history',
      'earnings',
      'wallet',
      'promotions',
      'performance',
      'notifications',
    ]);

    // No 'settings'. The screen is deleted and its four rows are grouped on
    // Profile — the owner's *"so we don't need the settings page"*. Asserted
    // as the whole list rather than a `not.toContain`, so re-adding the row
    // fails here rather than only on the device.
    expect(account?.rows.map((row) => row.key)).toEqual([
      'profile',
      'documents',
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

  it('sends the drawer s own screens to the Profile stack, so they keep the tab bar', () => {
    const list = rows();

    for (const key of ['notifications', 'safety', 'support']) {
      const row = list.find((candidate) => candidate.key === key);

      expect(row?.destination.tab).toBe('Profile');
      expect(row?.destination.screen).toBeDefined();
    }
  });

  /*
   * **Inverted after a device run, not deleted.** The original asserted the
   * four tab rows named no screen, "so each resumes where it was" — and the
   * owner found the failure that reasoning hides: stand on Documents (inside
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
    expect(rows(3).find((row) => row.key === 'notifications')?.badge).toBe(3);
  });

  it('carries null while the count is unknown, which draws no dot', () => {
    // Null and zero must not look the same: a drawer drawing no dot because
    // the count had not loaded is indistinguishable from one drawing none
    // because there is nothing to read, and only the first is temporary.
    expect(rows(null).find((row) => row.key === 'notifications')?.badge).toBeNull();
  });
});

// -- Which row is lit ------------------------------------------------------

describe('the selected row', () => {
  it('lights the tab root a driver is on', () => {
    expect(selectedRowKey(drawerSections(null), 'Wallet', 'WalletHome')).toBe('wallet');
  });

  it('lights the nested screen rather than its tab', () => {
    // Three rows below the rule live inside the Profile tab. Lighting
    // "Profile" while a driver reads Documents would tell them they are
    // somewhere they are not, on the one control whose whole job is saying
    // where they are.
    expect(selectedRowKey(drawerSections(null), 'Profile', 'Documents')).toBe('documents');
    expect(selectedRowKey(drawerSections(null), 'Profile', 'ProfileHome')).toBe('profile');
  });

  /**
   * The Settings screen is gone and its rows are on Profile. A driver standing
   * on one of those pushed screens is on no drawer row at all — Profile must
   * not light up for them, which is the same claim the case above makes from
   * the other side.
   */
  it('lights nothing for a screen the drawer no longer lists', () => {
    expect(selectedRowKey(drawerSections(null), 'Profile', 'ChangePassword')).toBeNull();
  });

  it('lights nothing rather than defaulting to Home', () => {
    // A driver on the Odometer modal or a live-leg screen is on none of these,
    // and lighting Home would be a claim rather than a default. (Before the
    // tab rows named their roots, 'Home'/'Odometer' lit Home through the
    // tab-only fallback; the stricter answer is the honest one.)
    expect(selectedRowKey(drawerSections(null), 'Home', 'Odometer')).toBeNull();
    expect(selectedRowKey(drawerSections(null), undefined, undefined)).toBeNull();
  });
});
