import type {
  DriverDocumentCompliance,
  DriverDocumentComplianceState,
  DriverDocumentSlot,
  DriverProfile,
} from '../api/endpoints';

/**
 * How the profile screen says things.
 *
 * Pure functions with tests, rather than expressions inside the screen. That
 * is not tidiness: `HomeScreen` once shipped an inline money formatter that
 * divided a zero-decimal currency by a hundred and rendered a 20,500-shilling
 * day as "UGX 205", and nothing caught it because an inline helper has no
 * test. Every rule that could be wrong lives here.
 */

/**
 * The monogram that stands where the mockup drew a photograph.
 *
 * **There is no avatar on this platform** — no column, no upload, no storage —
 * and a stock face is the defect three screens have already refused for
 * passengers. Initials are *derived from the driver's own name*, so they are a
 * fact rather than a picture of somebody else.
 *
 * First and last word, so "Jonathan Kamau Musoke" is JM rather than JK: a
 * family name identifies better than a middle one. One word gives one letter
 * rather than two from the same word, which would read as a stutter.
 *
 * `Array.from` rather than `charAt`, because a name may begin with a character
 * outside the basic plane and `[0]` would return half of it. This app is meant
 * to leave Uganda.
 */
export function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter((word) => word !== '');

  if (words.length === 0) {
    return '—';
  }

  const first = words[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] ?? '' : '';

  const letter = (word: string): string => Array.from(word)[0]?.toUpperCase() ?? '';

  return `${letter(first)}${letter(last)}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * "Jan 2024", from a `YYYY-MM-DD` the server computed.
 *
 * Parsed by pattern rather than by `new Date(...)`, which on a bare date
 * string is interpreted as **UTC** and then rendered in the handset's zone —
 * so `2024-01-01` shows as December 2023 anywhere west of Greenwich. The
 * string is already the operator's day; re-interpreting it can only move it.
 *
 * `Intl` is avoided for the reason `formatMoney` avoids it: Hermes ships it,
 * but its locale data varies by platform and build, and a fleet should read
 * the same date on every handset and in every test.
 *
 * An unparseable value returns the raw string rather than an invented date —
 * the `FinancialPeriod::label` rule, and the same one `dateLabel` follows.
 */
export function monthYear(date: string | null | undefined): string {
  if (date === null || date === undefined || date === '') {
    return '—';
  }

  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(date);

  if (match === null) {
    return date;
  }

  const month = MONTHS[Number(match[2]) - 1];

  return month === undefined ? date : `${month} ${match[1]}`;
}

/**
 * A `Date` from the picker, as the `YYYY-MM-DD` the server wants.
 *
 * **Built from the local getters, never `toISOString()`.** That method
 * converts to UTC first, so a date chosen in Kampala at any time before 03:00
 * comes back as the *previous* day — a licence expiring on the 1st filed as
 * expiring on the 31st. The picker hands back a local calendar date and the
 * server stores a local calendar date; converting between them can only
 * introduce an error.
 */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * "Toyota Wish · UBB 123X", degrading to whatever is actually known.
 *
 * The plate is the part that never goes missing, so it is the part that is
 * always shown. `make` and `model` are individually nullable — a plate typed
 * in a hurry with no make is a real row — and a name assembled out of blanks
 * would read as "undefined undefined · UBB 123X", which is the shape of bug
 * this module exists to prevent.
 *
 * A driver with no vehicle at all gets an em dash, not an empty string: that
 * is not an edge case, it is every corporate driver who takes whatever the
 * depot hands them.
 */
export function vehicleName(profile: DriverProfile | undefined): string {
  const vehicle = profile?.vehicle;

  if (vehicle === null || vehicle === undefined) {
    return '—';
  }

  const model = [vehicle.make, vehicle.model].filter((part) => part !== null && part !== '');

  return model.length === 0
    ? vehicle.registration_number
    : `${model.join(' ')} · ${vehicle.registration_number}`;
}

export function vehicleType(profile: DriverProfile | undefined): string {
  return profile?.vehicle?.category_label ?? '—';
}

/**
 * "428 trips", beside the rating.
 *
 * The mockup's "(428 trips)". It is a count of rows that exist, so it is
 * allowed — unlike the rating next to it, which the server withholds below
 * five ratings.
 *
 * Zero is a **known** zero and reads as one: a driver on their first shift has
 * finished no trips, and saying so is true. That is the distinction
 * `docs/screen-rules.md` §1 draws — a zero standing in for a figure the
 * platform cannot produce is the banned case, and this is not it.
 */
export function tripsTotal(profile: DriverProfile | undefined): string {
  if (profile === undefined) {
    return '—';
  }

  if (profile.trips_total === 0) {
    return 'No trips yet';
  }

  return `${profile.trips_total} ${profile.trips_total === 1 ? 'trip' : 'trips'}`;
}

/**
 * The word beside "Documents" in the menu, and how loudly to say it.
 *
 * Four states, and the split between the middle two is the one that matters:
 * `action_needed` means the office looked and something is wrong,
 * `incomplete` means they are still waiting for it. Collapsing them would make
 * a new driver who has uploaded nothing look like a driver with a rejected
 * licence.
 *
 * **Never guesses.** With no compliance summary loaded it says so rather than
 * assuming the friendly answer — a screen that defaults to "Verified" while
 * offline is the exact lie ADR-0033 exists to prevent.
 */
export function documentsSummary(
  compliance: DriverDocumentCompliance | null | undefined,
): { label: string; tone: 'good' | 'warning' | 'danger' | 'muted' } {
  if (compliance === null || compliance === undefined) {
    return { label: '—', tone: 'muted' };
  }

  switch (compliance.state) {
    case 'verified':
      return { label: 'Verified', tone: 'good' };
    case 'action_needed':
      return {
        label: `${compliance.action_needed} needs attention`,
        tone: 'danger',
      };
    case 'incomplete': {
      const missing = compliance.total - compliance.verified - compliance.pending;

      return { label: `${missing} still to send`, tone: 'warning' };
    }
    default:
      return { label: 'Waiting for the office', tone: 'muted' };
  }
}

/**
 * One document row's state, in words and in a tone.
 *
 * Reads `compliance_state` and **never** `status`: a verified licence that
 * lapsed last month still carries `status: 'verified'`, because nothing wrote
 * to the row. Rendering that would tell a driver their expired licence is
 * fine, which is the single most dangerous thing this screen could say.
 *
 * The tone is never the only carrier of the meaning — `docs/screen-rules.md`
 * §6 — so every case returns a label as well, and the screen draws both.
 */
export function documentState(slot: DriverDocumentSlot): {
  label: string;
  tone: 'good' | 'warning' | 'danger' | 'muted';
  state: DriverDocumentComplianceState | 'missing';
} {
  const document = slot.document;

  if (document === null) {
    return { label: 'Not sent yet', tone: 'muted', state: 'missing' };
  }

  switch (document.compliance_state) {
    case 'verified':
      return { label: 'Verified', tone: 'good', state: 'verified' };
    case 'expired':
      return { label: 'Expired', tone: 'danger', state: 'expired' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger', state: 'rejected' };
    default:
      return { label: 'Waiting for the office', tone: 'warning', state: 'pending' };
  }
}

/**
 * The line under a document row: why it is in the state it is in.
 *
 * A rejection shows the office's own words — that is the whole reason the
 * server requires a reason. Anything else shows the expiry, which is the fact
 * a driver is most often opening this screen to check.
 */
export function documentNote(slot: DriverDocumentSlot): string {
  const document = slot.document;

  if (document === null) {
    return slot.hint;
  }

  if (document.compliance_state === 'rejected' && document.rejection_reason !== null) {
    return document.rejection_reason;
  }

  if (document.expires_at === null) {
    if (document.compliance_state === 'pending') {
      return 'Sent. The office will check it.';
    }

    // **Not the hint.** Reading the rendered screen caught this: a verified
    // identity document was showing "A national ID, passport, or whatever your
    // country issues" — an instruction to do a thing that is already done, on
    // the one row that should read as settled.
    return document.compliance_state === 'verified'
      ? 'Accepted by the office.'
      : slot.hint;
  }

  const expiry = monthYear(document.expires_at);

  return document.expired ? `Expired ${expiry}` : `Expires ${expiry}`;
}

/**
 * What the button on a document row should say.
 *
 * Three verbs for three situations, and the middle one is why this is a
 * function rather than a ternary in the screen: a **rejected** document was
 * reading "Replace it", which describes swapping out something that worked.
 * The office has asked for it again, and the button should say so.
 */
export function documentAction(slot: DriverDocumentSlot): string {
  const state = documentState(slot).state;

  if (state === 'missing') {
    return 'Take a photo';
  }

  return state === 'rejected' || state === 'expired' ? 'Send it again' : 'Replace it';
}

/**
 * Whether to warn that a new photo restarts the review.
 *
 * **Only on a verified document**, which reading the rendered screen made
 * obvious: the warning was appearing under a *rejected* row, where sending
 * another photo is precisely what the office has asked for, and under a
 * *pending* one, where there is no review to restart. In both places it
 * discouraged the action the screen exists to prompt.
 *
 * On a verified document it is worth saying, because ADR-0033 §2 makes a
 * replacement reset the review and a driver retaking a photo out of habit
 * would otherwise lose a status they had waited for.
 */
export function warnsAboutReplacing(slot: DriverDocumentSlot): boolean {
  return documentState(slot).state === 'verified';
}

/**
 * One sentence for a screen reader, instead of a row that linearises into
 * disconnected fragments.
 *
 * `docs/screen-rules.md` §6 asks for a composed announcement rather than
 * leaving a grid to be read as loose values. The order is the order a person
 * needs it: what the document is, then what state it is in, then why.
 */
export function documentAnnouncement(slot: DriverDocumentSlot): string {
  return `${slot.type_label}. ${documentState(slot).label}. ${documentNote(slot)}`;
}
