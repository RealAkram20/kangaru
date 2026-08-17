import { notificationLook, whenLabel } from './presentation';

/**
 * How one notification presents itself.
 *
 * The clock is injected throughout — a test that read the wall clock would
 * pass on a Tuesday and fail on a Sunday.
 */

const now = new Date('2026-08-15T12:00:00Z');

const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

it('says "Just now" under a minute', () => {
  expect(whenLabel(ago(30_000), now)).toBe('Just now');
});

it('counts minutes, then hours, then days', () => {
  expect(whenLabel(ago(12 * MINUTE), now)).toBe('12 minutes ago');
  expect(whenLabel(ago(3 * HOUR), now)).toBe('3 hours ago');
  expect(whenLabel(ago(3 * DAY), now)).toBe('3 days ago');
});

it('keeps the singular', () => {
  expect(whenLabel(ago(MINUTE + 5_000), now)).toBe('1 minute ago');
  expect(whenLabel(ago(HOUR + 5_000), now)).toBe('1 hour ago');
});

it('says "Yesterday" rather than "1 days ago"', () => {
  expect(whenLabel(ago(DAY + HOUR), now)).toBe('Yesterday');
});

it('switches to a date after a week, because "9 days ago" is arithmetic', () => {
  // Relative time is easier to act on while it is recent and stops being
  // useful fast. A date is a fact; a nine-day count is a sum somebody has to
  // do in their head.
  expect(whenLabel(ago(9 * DAY), now)).toBe('6 Aug');
});

it('clamps a future timestamp to the present rather than counting forward', () => {
  // Clock skew between a handset and the server is ordinary. "In 3 minutes"
  // on an inbox reads as a bug.
  expect(whenLabel(new Date(now.getTime() + 3 * MINUTE).toISOString(), now)).toBe('Just now');
});

it('renders an em dash for a timestamp it cannot read', () => {
  // Never "Invalid Date". `docs/screen-rules.md` §1 covers a date the app
  // could not read as much as a figure it could not produce.
  expect(whenLabel('not a date', now)).toBe('—');
});

// -- What kind of message it is --------------------------------------------

it('gives every type this platform sends its own glyph', () => {
  // Five cases in `NotificationType`, five distinct shapes. Two kinds sharing
  // a glyph would make the icon column decoration rather than information.
  const glyphs = [
    'trip.offered',
    'booking.approved',
    'booking.rejected',
    'report.export.ready',
    'order_request.received',
  ].map((type) => notificationLook(type).glyph);

  expect(new Set(glyphs).size).toBe(glyphs.length);
  expect(glyphs).not.toContain('other');
});

it('tells an approved booking from a rejected one by more than colour', () => {
  // DESIGN.md §3: status is never carried by colour alone. The two tones
  // differ *and* so do the shapes, which is what carries it for anyone who
  // cannot separate the hues.
  const approved = notificationLook('booking.approved');
  const rejected = notificationLook('booking.rejected');

  expect(approved.tone).not.toBe(rejected.tone);
  expect(approved.glyph).not.toBe(rejected.glyph);
});

it('falls back to a bell for a type it has never seen', () => {
  // The server's enum can gain a case tomorrow and every installed handset
  // still has to draw the row. An unknown type is a message, not a crash.
  expect(notificationLook('document.expiring')).toEqual({ glyph: 'other', tone: 'neutral' });
  expect(notificationLook('')).toEqual({ glyph: 'other', tone: 'neutral' });
});

it('matches on the stable type, never on words that will be translated', () => {
  // `NotificationResource` sends `type` for exactly this reason. A screen that
  // read the subject would break on the first localised string, which
  // PRODUCT.md's international-readiness makes a matter of when, not whether.
  expect(notificationLook('New job').glyph).toBe('other');
  expect(notificationLook('trip.offered').glyph).toBe('job');
});
