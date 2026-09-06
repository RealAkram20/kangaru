import { OFFICE_MANAGED, hasChanged, problemWith } from './editing';

describe('hasChanged', () => {
  it('is false when only whitespace differs', () => {
    // The case this exists for: a driver taps into the field, the keyboard
    // adds nothing, and they tap Save. Sending it would write an audit-log
    // entry recording a change that did not happen.
    expect(hasChanged('John Kamau ', 'John Kamau')).toBe(false);
    expect(hasChanged('  John Kamau', 'John Kamau')).toBe(false);
  });

  it('is true for a real edit', () => {
    expect(hasChanged('John Kamau', 'Jon Kamau')).toBe(true);
  });

  it('treats a missing current value as empty rather than throwing', () => {
    // `phone` is nullable on the payload. A driver with no number on file is a
    // real row, and it is exactly the driver most likely to add one.
    expect(hasChanged('+256700123456', null)).toBe(true);
    expect(hasChanged('', null)).toBe(false);
  });
});

describe('problemWith', () => {
  it('refuses a blank value, naming the field', () => {
    expect(problemWith('name', '   ')).toBe('A name cannot be blank.');
    expect(problemWith('phone', '')).toBe('A phone number cannot be blank.');
  });

  it('accepts every international shape the server accepts', () => {
    // Asserted as a list rather than one example. A regex tuned to +256 would
    // pass a single Ugandan case and refuse the rest, which is precisely the
    // bug this function is written to avoid.
    for (const number of ['+256700123456', '0700123456', '+254712345678', '+44 7700 900123']) {
      expect(problemWith('phone', number)).toBeNull();
    }
  });

  it('refuses only what the server would refuse', () => {
    expect(problemWith('name', 'a'.repeat(256))).toBe('That name is too long.');
    expect(problemWith('name', 'a'.repeat(255))).toBeNull();
    expect(problemWith('phone', '0'.repeat(51))).toBe('That phone number is too long.');
    expect(problemWith('phone', '0'.repeat(50))).toBeNull();
  });
});

describe('OFFICE_MANAGED', () => {
  it('explains every field the screen shows as read-only', () => {
    // A count, not a spot check. A field added to the screen without a reason
    // beside it is the "incomplete" reading this rebuild exists to fix, and an
    // existence assertion would not notice one going missing.
    expect(Object.keys(OFFICE_MANAGED)).toEqual(['vehicle', 'licence', 'email']);
    expect(Object.keys(OFFICE_MANAGED)).toHaveLength(3);

    for (const reason of Object.values(OFFICE_MANAGED)) {
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
