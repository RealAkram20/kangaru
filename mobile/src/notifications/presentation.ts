/**
 * How one notification presents itself: when it arrived, and what it is.
 *
 * A module rather than a helper in the component, for `duty/offerPresentation`'s
 * reason: this is the part that can be *wrong* rather than merely ugly, and a
 * pure function over an injected clock is a suite worth trusting.
 */

/**
 * The glyph a kind of message is drawn with. A key rather than a component, so
 * this module stays pure and testable; `NotificationsScreen` holds the one map
 * from key to icon, and `Record<NotificationGlyph, …>` makes `tsc` refuse a
 * glyph nobody drew.
 */
export type NotificationGlyph =
  | 'job'
  | 'approved'
  | 'rejected'
  | 'export'
  | 'order'
  /** The office's answer to something the driver wrote (ADR-0044). */
  | 'answer'
  | 'other';

/**
 * What the message *is*, in colour.
 *
 * **Never the only thing carrying that** — `docs/screen-rules.md` §6. The
 * server sends `type_label` ("New job", "Booking rejected") and the row prints
 * it, so a driver who cannot separate the hues loses nothing. The tint is
 * redundant emphasis on a list that is otherwise undifferentiated text.
 */
export type NotificationTone = 'brand' | 'good' | 'danger' | 'info' | 'neutral';

/**
 * The look of one kind of message, chosen by `type`.
 *
 * ## By type, never by subject
 *
 * `NotificationResource` sends the stable enum name for exactly this purpose —
 * its own comment says *"so a client can style or route by kind without
 * matching on the subject line"*. A screen that matched words out of the
 * subject would break on the first translated string, which PRODUCT.md's
 * international-readiness makes a matter of when rather than whether.
 *
 * ## An unknown type is a bell, not a crash
 *
 * The server's enum can gain a case tomorrow and every installed handset must
 * still draw the row. `default` is the contract here, not an oversight: the
 * subject, the body and the timestamp are all still true, and only the glyph
 * is unknown.
 *
 * ## Two of these reach a driver
 *
 * `trip.offered` and, since ADR-0044, `driver.support.answered` — the answer to
 * a report the driver themselves wrote. The booking pair goes to whoever asked
 * for transport, the export to the person who ran the report, the walk-in to
 * the dispatch desk. The rest are mapped
 * because an inbox is a shared surface and a driver who is also staff on a
 * small deployment will see them. Nothing here invents a kind that does not
 * exist; see `docs/adr/0039-driver-notifications.md` for what the mockup asked
 * for and why it was not fabricated.
 */
export function notificationLook(type: string): { glyph: NotificationGlyph; tone: NotificationTone } {
  switch (type) {
    case 'trip.offered':
      return { glyph: 'job', tone: 'brand' };
    case 'booking.approved':
      return { glyph: 'approved', tone: 'good' };
    case 'booking.rejected':
      return { glyph: 'rejected', tone: 'danger' };
    case 'report.export.ready':
      return { glyph: 'export', tone: 'neutral' };
    case 'order_request.received':
      return { glyph: 'order', tone: 'info' };
    /*
      ADR-0044, and **the second type this platform addresses to a driver** —
      the note below about `trip.offered` being the only one is no longer true
      and is corrected there.

      `info` rather than `good`: an answer is not a verdict. The office may
      have agreed, refused or asked for more, and a green row would announce
      an outcome before the driver has read a word of it.
    */
    case 'driver.support.answered':
      return { glyph: 'answer', tone: 'info' };
    default:
      return { glyph: 'other', tone: 'neutral' };
  }
}

/**
 * "Just now", "12 minutes ago", "Yesterday", "12 Aug".
 *
 * ## Relative up to a point, then absolute
 *
 * Relative time is easier to act on while it is recent — "8 minutes ago" tells
 * a driver something "10:42" does not. It stops being useful fast: "9 days
 * ago" is arithmetic somebody has to do, where a date is a fact. The crossover
 * is a week.
 *
 * ## The clock is injected
 *
 * A test that reads the wall clock passes on a Tuesday and fails on a Sunday.
 *
 * Returns an em dash for an unparseable timestamp rather than "Invalid Date" —
 * `docs/screen-rules.md` §1 covers a date the app could not read as much as a
 * figure it could not produce.
 */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) {
    return '—';
  }

  const elapsedMs = now.getTime() - at.getTime();

  // A timestamp slightly in the future is a clock-skew artefact between the
  // handset and the server, not a scheduled message. "In 3 minutes" on an
  // inbox would read as a bug, so it is clamped to the present.
  if (elapsedMs < 60_000) {
    return 'Just now';
  }

  const minutes = Math.floor(elapsedMs / 60_000);

  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  const days = Math.floor(hours / 24);

  if (days === 1) {
    return 'Yesterday';
  }

  if (days < 7) {
    return `${days} days ago`;
  }

  // Absolute from here. Day and month only — the year is noise on an inbox
  // nobody keeps for twelve months, and adding it would push the line wider
  // than the row it sits in.
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
