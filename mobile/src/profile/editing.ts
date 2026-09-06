/**
 * The rules the Profile screen's inline editor follows.
 *
 * Extracted rather than inlined for the reason the home screen's money
 * formatter was: an inline helper with no tests is how `undefined NaN` shipped
 * to a driver's earnings tile. These are small, and every one of them decides
 * whether a save is attempted.
 */

/** What a driver may change about themselves. Mirrors the server's allow-list. */
export type EditableField = 'name' | 'phone';

/**
 * Whether a value is worth sending.
 *
 * **Trims before comparing**, so re-saving `"John Kamau "` after an accidental
 * space is a no-op rather than a write. The server would accept it and the
 * audit log would record a change nobody made.
 */
export function hasChanged(next: string, current: string | null): boolean {
  return next.trim() !== (current ?? '').trim();
}

/**
 * The reason a value cannot be saved, or null when it can.
 *
 * Mirrors `UpdateDriverProfileRequest` — **deliberately not more strictly.**
 * The server allows any string up to 50 characters for a phone number because
 * PRODUCT.md is East Africa first and international after, and a handset regex
 * tuned to `+256` would refuse a Kenyan `+254` the office had already accepted.
 * The only thing worth catching here is the one the server would also refuse,
 * caught early to save a driver a round trip on a bad connection.
 */
export function problemWith(field: EditableField, value: string): string | null {
  const trimmed = value.trim();

  if (trimmed === '') {
    return field === 'name' ? 'A name cannot be blank.' : 'A phone number cannot be blank.';
  }

  if (field === 'name' && trimmed.length > 255) {
    return 'That name is too long.';
  }

  if (field === 'phone' && trimmed.length > 50) {
    return 'That phone number is too long.';
  }

  return null;
}

/**
 * The one-line answer beside "Bank Details" on the profile screen.
 *
 * **Never the account number, not even the masked one.** The row sits on a
 * screen a driver opens in front of passengers and dispatchers; the tail is
 * for the Bank Details screen itself, where they went looking for it. This
 * answers only *have you told the office where to pay you* — which is the
 * question the row is there to prompt.
 *
 * Null while the query is still loading, so the row renders no value rather
 * than flashing "Not set" at somebody who has set one.
 */
export function payoutSummary(
  account: { kind_label: string; institution: string } | null | undefined,
): string | null {
  if (account === undefined) {
    return null;
  }

  if (account === null) {
    return 'Not set';
  }

  return account.institution;
}

/**
 * What the office manages, and why — shown on the screen rather than left as
 * an absence.
 *
 * **This is the difference the rebuild is being made for.** A screen that
 * simply omits an editing control reads as unfinished; one that says who holds
 * the field reads as deliberate. Every sentence here is a fact about this
 * platform, not a policy invented on the handset:
 *
 * - The licence is the compliance record the office verifies (ADR-0033).
 * - The vehicle is a depot allocation.
 * - The sign-in email is the credential (ADR-0016).
 */
export const OFFICE_MANAGED: Record<string, string> = {
  vehicle: 'The depot allocates vehicles.',
  licence: 'The office checks licence details against your documents.',
  email: 'Ask the office to change the email you sign in with.',
};
