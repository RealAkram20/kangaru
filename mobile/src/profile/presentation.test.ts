import type {
  DriverDocumentCompliance,
  DriverDocumentSlot,
  DriverProfile,
} from '../api/endpoints';
import {
  documentAnnouncement,
  documentNote,
  documentState,
  documentsSummary,
  initials,
  isoDate,
  monthYear,
  tripsTotal,
  vehicleName,
  vehicleType,
} from './presentation';

/**
 * How the profile and documents screens say things.
 *
 * Every rule here could be silently wrong, which is the whole reason these are
 * functions with tests rather than expressions inside a screen: `HomeScreen`
 * once shipped an inline money formatter that rendered a 20,500-shilling day
 * as "UGX 205", and an inline helper has no test to catch it.
 */

function profile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    name: 'John Kamau',
    // ADR-0041 made this required on `DriverProfile`.
    photo_url: null,
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
    documents: compliance(),
    ...overrides,
  };
}

function compliance(overrides: Partial<DriverDocumentCompliance> = {}): DriverDocumentCompliance {
  return { state: 'verified', verified: 4, total: 4, action_needed: 0, pending: 0, ...overrides };
}

function slot(overrides: Partial<DriverDocumentSlot> = {}): DriverDocumentSlot {
  return {
    type: 'driving_licence',
    type_label: 'Driving licence',
    hint: 'Both sides if the details are split across them.',
    requires_expiry: true,
    document: null,
    ...overrides,
  };
}

function document(overrides: Partial<NonNullable<DriverDocumentSlot['document']>> = {}) {
  return {
    id: 1,
    driver_id: 2,
    type: 'driving_licence' as const,
    type_label: 'Driving licence',
    status: 'verified' as const,
    status_label: 'Verified',
    compliance_state: 'verified' as const,
    expires_at: '2028-03-14',
    expired: false,
    original_name: 'licence.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 240_000,
    uploaded_at: '2026-08-15T10:00:00+03:00',
    rejection_reason: null,
    reviewed_at: '2026-08-15T11:00:00+03:00',
    file_url: '/api/v1/me/documents/1/file',
    ...overrides,
  };
}

// -- The monogram ---------------------------------------------------------

describe('initials', () => {
  it('takes the first and last word', () => {
    // The family name identifies better than a middle one, so a three-part
    // name is JM rather than JK.
    expect(initials('Jonathan Kamau Musoke')).toBe('JM');
    expect(initials('John Kamau')).toBe('JK');
  });

  it('gives one letter for one word, not the same word twice', () => {
    expect(initials('Kamau')).toBe('K');
  });

  it('does not split a character outside the basic plane', () => {
    // `[0]` on a surrogate pair returns half of it and renders as a box. This
    // app is meant to leave Uganda.
    expect(initials('𝒥ohn Kamau')).toBe('𝒥K');
  });

  it('renders an em dash rather than an empty circle', () => {
    expect(initials(undefined)).toBe('—');
    expect(initials('   ')).toBe('—');
  });
});

// -- Dates ----------------------------------------------------------------

describe('monthYear', () => {
  it('renders a month and a year', () => {
    expect(monthYear('2024-01-15')).toBe('Jan 2024');
  });

  it('does not move the date into another month', () => {
    // `new Date('2024-01-01')` is parsed as UTC and rendered in the handset's
    // zone, so anywhere west of Greenwich it shows as December 2023. Parsing
    // the string by pattern is what makes this stable.
    expect(monthYear('2024-01-01')).toBe('Jan 2024');
    expect(monthYear('2024-12-31')).toBe('Dec 2024');
  });

  it('returns the raw value rather than inventing a date', () => {
    expect(monthYear('not a date')).toBe('not a date');
    expect(monthYear(null)).toBe('—');
  });
});

describe('isoDate', () => {
  it('uses the local calendar date, not UTC', () => {
    // A licence expiring on the 1st, chosen in Kampala at 01:00, must not be
    // filed as expiring on the 31st — which is what `toISOString()` gives.
    const early = new Date(2027, 2, 1, 1, 0, 0);

    expect(isoDate(early)).toBe('2027-03-01');
  });

  it('pads the month and the day', () => {
    expect(isoDate(new Date(2027, 0, 5))).toBe('2027-01-05');
  });
});

// -- The vehicle ----------------------------------------------------------

describe('vehicleName', () => {
  it('reads make, model and plate', () => {
    expect(vehicleName(profile())).toBe('Toyota Wish · UBB 123X');
  });

  it('falls back to the plate rather than assembling blanks', () => {
    // A plate typed in a hurry with no make is a real row, and
    // "undefined undefined · UBB 123X" is the shape of bug this prevents.
    const bare = profile({
      vehicle: {
        make: null,
        model: null,
        registration_number: 'UBB 123X',
        category: 'sedan',
        category_label: 'Sedan',
      },
    });

    expect(vehicleName(bare)).toBe('UBB 123X');
  });

  it('renders an em dash for a driver with no vehicle', () => {
    // Not an edge case: every corporate driver takes whatever the depot hands
    // them that morning.
    expect(vehicleName(profile({ vehicle: null }))).toBe('—');
    expect(vehicleType(profile({ vehicle: null }))).toBe('—');
  });

  it('renders an em dash before anything has loaded', () => {
    expect(vehicleName(undefined)).toBe('—');
  });
});

// -- The trip count -------------------------------------------------------

describe('tripsTotal', () => {
  it('counts trips', () => {
    expect(tripsTotal(profile())).toBe('428 trips');
    expect(tripsTotal(profile({ trips_total: 1 }))).toBe('1 trip');
  });

  it('says none rather than showing a bare zero', () => {
    // A known zero, which `docs/screen-rules.md` §1 permits — the banned case
    // is a zero standing in for a figure the platform cannot produce.
    expect(tripsTotal(profile({ trips_total: 0 }))).toBe('No trips yet');
  });

  it('renders an em dash before anything has loaded', () => {
    expect(tripsTotal(undefined)).toBe('—');
  });
});

// -- The compliance summary -----------------------------------------------

describe('documentsSummary', () => {
  it('says verified only when everything is', () => {
    expect(documentsSummary(compliance())).toEqual({ label: 'Verified', tone: 'good' });
  });

  it('distinguishes something wrong from something missing', () => {
    // Collapsing these would make a new driver who has uploaded nothing look
    // like a driver with a rejected licence.
    expect(
      documentsSummary(compliance({ state: 'action_needed', verified: 3, action_needed: 1 })),
    ).toEqual({ label: '1 needs attention', tone: 'danger' });

    expect(
      documentsSummary(compliance({ state: 'incomplete', verified: 1, pending: 1 })),
    ).toEqual({ label: '2 still to send', tone: 'warning' });
  });

  it('never guesses the friendly answer when nothing has loaded', () => {
    // A screen that defaults to "Verified" while offline is the exact lie
    // ADR-0033 exists to prevent.
    expect(documentsSummary(undefined)).toEqual({ label: '—', tone: 'muted' });
    expect(documentsSummary(null)).toEqual({ label: '—', tone: 'muted' });
  });
});

// -- A document row -------------------------------------------------------

describe('documentState', () => {
  it('reads compliance_state, not status', () => {
    // **The important one.** A verified licence that lapsed last month still
    // carries `status: 'verified'` because nothing wrote to the row. Rendering
    // that would tell a driver their expired licence is fine.
    const lapsed = slot({
      document: document({ compliance_state: 'expired', expired: true, expires_at: '2026-07-01' }),
    });

    expect(documentState(lapsed)).toEqual({ label: 'Expired', tone: 'danger', state: 'expired' });
    expect(lapsed.document?.status).toBe('verified');
  });

  it('marks a type never uploaded as missing rather than wrong', () => {
    expect(documentState(slot())).toEqual({
      label: 'Not sent yet',
      tone: 'muted',
      state: 'missing',
    });
  });

  it('names each of the other states', () => {
    expect(documentState(slot({ document: document() })).label).toBe('Verified');
    expect(
      documentState(slot({ document: document({ status: 'pending', compliance_state: 'pending' }) }))
        .label,
    ).toBe('Waiting for the office');
    expect(
      documentState(
        slot({ document: document({ status: 'rejected', compliance_state: 'rejected' }) }),
      ).label,
    ).toBe('Rejected');
  });
});

describe('documentNote', () => {
  it("shows the office's own words on a rejection", () => {
    // The whole reason the server requires a reason: a driver told "no" with
    // no explanation re-uploads the same photograph.
    const rejected = slot({
      document: document({
        status: 'rejected',
        compliance_state: 'rejected',
        rejection_reason: 'Too dark to read the chassis number.',
      }),
    });

    expect(documentNote(rejected)).toBe('Too dark to read the chassis number.');
  });

  it('shows the expiry, and says when it has passed', () => {
    expect(documentNote(slot({ document: document() }))).toBe('Expires Mar 2028');

    const lapsed = slot({
      document: document({ compliance_state: 'expired', expired: true, expires_at: '2026-07-01' }),
    });

    expect(documentNote(lapsed)).toBe('Expired Jul 2026');
  });

  it("shows the server's hint for a type never uploaded", () => {
    // Served rather than written here, so the app carries no second copy of
    // what each document is.
    expect(documentNote(slot())).toBe('Both sides if the details are split across them.');
  });
});

describe('documentAnnouncement', () => {
  it('composes one sentence rather than three loose values', () => {
    // `docs/screen-rules.md` §6: a grid left to linearise reads as
    // disconnected fragments to somebody who cannot see the layout.
    expect(documentAnnouncement(slot({ document: document() }))).toBe(
      'Driving licence. Verified. Expires Mar 2028',
    );
  });
});
