/**
 * What the drawer lists, as data rather than as JSX.
 *
 * A module rather than an array inside the component, for the reason
 * `duty/offerPresentation.ts` gives: the parts that can be *wrong* rather than
 * merely ugly belong somewhere a pure test can reach. The rows encode two
 * decisions that are easy to get quietly wrong — which screen a row opens, and
 * whether a row should be there at all — and both are invisible in a snapshot.
 *
 * ## The drawer is the whole map of the app
 *
 * It replaced `ProfileScreen`'s list rather than joining it. The owner's
 * instruction was *"we don't need to repeat the menus"*, and two menus that
 * drift is worse than either of them: a driver who learns the app from one
 * would find rows missing from the other.
 *
 * The four **tabs** are still listed here. That is not a repeat in the sense
 * above — the tab bar is a shortcut to the four screens a driver touches
 * daily, and a map of the app that omitted its four biggest destinations would
 * be a strange map. Selecting one moves the tab rather than pushing a screen.
 */

/**
 * Where a row goes.
 *
 * Expressed as the tab plus an optional screen *inside* that tab's stack,
 * rather than as a flat route name, because the drawer sits above the tab
 * navigator and every destination is nested inside one of its four stacks.
 * A flat name would have to be resolved somewhere, and doing it here means a
 * test can assert the destination without mounting a navigator.
 */
export type DrawerDestination = {
  tab: 'Home' | 'Earnings' | 'Wallet' | 'Profile';
  /**
   * Always present in practice, tab roots included — see the note inside
   * `drawerSections` for the device-found bug behind that. Optional in the
   * type only so `selectedRowKey`'s tab-level fallback stays expressible.
   */
  screen?: string;
  params?: Record<string, unknown>;
};

export type DrawerRow = {
  key: string;
  label: string;
  destination: DrawerDestination;
  /**
   * A count worth interrupting for, or null. Rendered as a dot rather than a
   * number when the figure is not itself meaningful.
   */
  badge?: number | null;
};

export type DrawerSection = {
  key: string;
  rows: DrawerRow[];
};

/*
 * **There is deliberately no live-trip row, and there was one until the owner
 * removed it.**
 *
 * It existed only while a trip was running and was labelled
 * `statusLabel(live.status)`, so a driver mid-capture read **"Passenger on
 * board"** in their menu — a lifecycle state name offered as a destination. The
 * owner asked what it was for, and the honest answer was: a second door to a
 * place the app already opens in one tap.
 *
 * `HomeScreen`'s `ActiveTripCard` is that one tap, it routes through the same
 * `tripDestination()`, and it sits on the screen the drawer is *opened from* —
 * so the row cost a driver a swipe and a read to reach something already in
 * front of them. The rule this drawer was built on is the owner's own *"we
 * don't need to repeat the menus"*, and this was the last repeat in it.
 *
 * The reasoning that kept it honest still applies to whatever replaces it, and
 * is kept here rather than deleted with the code: **a menu row that opens
 * "whichever trip was most recent" is a guess presented as navigation**, which
 * is why the mockup's global "Trip Details" row was refused in the first place.
 * Any future live-trip entry must name a specific trip and must route through
 * `tripDestination()` — never a hardcoded `TripDetail`, which would open the
 * record view on a running journey (a bug this repo has already fixed once).
 */

/**
 * The two lists the mockup draws, with the rule between them.
 *
 * The split is not decorative. Above the rule is **the work and the money** —
 * what a driver opens during a shift. Below it is **the account** — what they
 * open once a month. Ordering by frequency is what makes a thirteen-row menu
 * scannable at a glance from a cradle.
 *
 * @param unreadNotifications null while unknown, which draws no badge at all —
 *   a zero and an unloaded count must not look the same.
 */
export function drawerSections(unreadNotifications: number | null): DrawerSection[] {
  /*
   * **Every row names its screen, the tab rows included.** The first version
   * sent a tab row to the tab alone, on the theory that a tab should resume
   * wherever the driver left it. On a device that read as broken, and the
   * owner said so: stand on Documents — which lives inside the Profile stack —
   * open the drawer, tap **Profile**, and the navigator "resumes" the Profile
   * stack exactly where it is. Nothing moves. A menu row that does nothing
   * when tapped is indistinguishable from a dead control, and a drawer is a
   * list of destinations, not a list of stacks.
   *
   * Naming the root also keeps `navigate` cheap: a root already in the stack
   * is popped back to, so Home from deep in a trip is one transition, not a
   * remount.
   */
  const work: DrawerRow[] = [
    { key: 'home', label: 'Home', destination: { tab: 'Home', screen: 'TripsHome' } },
    { key: 'trips-history', label: 'Trips History', destination: { tab: 'Home', screen: 'TripsHistory' } },
    { key: 'earnings', label: 'Earnings', destination: { tab: 'Earnings', screen: 'EarningsHome' } },
    { key: 'wallet', label: 'Wallet', destination: { tab: 'Wallet', screen: 'WalletHome' } },
    { key: 'promotions', label: 'Promotions', destination: { tab: 'Profile', screen: 'Promotions' } },
    { key: 'performance', label: 'Performance', destination: { tab: 'Profile', screen: 'Performance' } },
    {
      key: 'notifications',
      label: 'Notifications',
      destination: { tab: 'Profile', screen: 'Notifications' },
      badge: unreadNotifications,
    },
  ];

  const account: DrawerRow[] = [
    { key: 'profile', label: 'Profile', destination: { tab: 'Profile', screen: 'ProfileHome' } },
    { key: 'documents', label: 'Vehicle & Documents', destination: { tab: 'Profile', screen: 'Documents' } },
    // No Settings row: the screen is gone and its four rows are grouped on
    // Profile (the owner's *"so we don't need the settings page"*). A drawer
    // row for a deleted route is the dead control this list exists to avoid.
    { key: 'safety', label: 'Help & Safety', destination: { tab: 'Profile', screen: 'Safety' } },
    { key: 'support', label: 'Support', destination: { tab: 'Profile', screen: 'Support' } },
  ];

  return [
    { key: 'work', rows: work },
    { key: 'account', rows: account },
  ];
}

/**
 * Which row to draw as selected, from the navigator's own state.
 *
 * Matched on **tab and screen together**, not on the tab alone. Three of the
 * rows below the rule live inside the Profile tab, and highlighting "Profile"
 * while a driver is reading Documents would tell them they are somewhere they
 * are not — on the one control whose whole job is saying where they are.
 *
 * Returns null rather than falling back to Home, because "no row matches" is a
 * real state: a driver on the Odometer modal or a live-leg screen is not on
 * any of these, and lighting Home up would be a claim rather than a default.
 */
export function selectedRowKey(
  sections: DrawerSection[],
  tab: string | undefined,
  screen: string | undefined,
): string | null {
  const rows = sections.flatMap((section) => section.rows);

  // An exact match first: a nested screen is more specific than its tab, and
  // checking tab-only first would match "Profile" before ever reaching
  // "Documents".
  const exact = rows.find(
    (row) => row.destination.tab === tab && row.destination.screen === screen,
  );

  if (exact !== undefined) {
    return exact.key;
  }

  const root = rows.find(
    (row) => row.destination.tab === tab && row.destination.screen === undefined,
  );

  return root?.key ?? null;
}
