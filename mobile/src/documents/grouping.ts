import type { DriverDocumentSlot, DriverDocumentType } from '../api/endpoints';

/**
 * The KYC screen's three headed sections, built from what the server sent.
 *
 * The mockup draws *Personal Information*, *Driver Information* and *Vehicle
 * Information* with six rows spread between them. That grouping is a fact the
 * server owns (`DriverDocumentGroup`, ADR-0048 §1) and this module's whole job
 * is to avoid re-deciding it here.
 */

export type DocumentSection = {
  /** The server's own key. Used for `key` props and nothing else. */
  group: string;
  /** The heading, in the server's words. Never spelled in this bundle. */
  label: string;
  slots: DriverDocumentSlot[];
};

/**
 * Split an ordered slot list into contiguous sections.
 *
 * **It walks the array and starts a section whenever `group` changes. It never
 * sorts.** That is the load-bearing decision in this file, and it is worth
 * stating why, because sorting is the obvious implementation:
 *
 * `DriverDocumentService::slotsFor()` already returns the six in
 * `DriverDocumentType::ordered()` — by group position, then by position within
 * the group — precisely so that both apps agree without either of them
 * sorting for itself. A client-side sort would need a copy of that ordering,
 * and a copy is a second place for it to be wrong. Worse, it would be wrong
 * *silently*: a seventh document type added to a new group would sort to the
 * end on the handset and to the middle in the console, and nobody would look
 * at the two screens side by side.
 *
 * So a handset that has never heard of a group still draws it, correctly
 * placed, with the server's own heading, and with no release.
 *
 * The consequence to accept: if the server ever returned an interleaved list —
 * personal, vehicle, personal — this would render *two* personal sections
 * rather than merging them. That is the honest rendering of a broken payload,
 * and it fails where somebody can see it rather than quietly reordering the
 * office's reading order.
 */
export function groupSlots(slots: DriverDocumentSlot[]): DocumentSection[] {
  const sections: DocumentSection[] = [];

  for (const slot of slots) {
    const current = sections[sections.length - 1];

    if (current !== undefined && current.group === slot.group) {
      current.slots.push(slot);

      continue;
    }

    sections.push({ group: slot.group, label: slot.group_label, slots: [slot] });
  }

  return sections;
}

/**
 * How many of the six the applicant has actually sent.
 *
 * Counts rows the server is holding a file for, whatever state the office has
 * put them in — a rejected document *was* sent, and telling somebody they have
 * sent three of six when one was refused would be a second, quieter lie on
 * top of the rejection they can already see on the row.
 *
 * The number is never used to gate the Submit button. ADR-0048 §6 keeps every
 * document optional at application time, and an applicant who uploads nothing
 * is in the queue on the same terms as one who uploads six.
 */
export function sentCount(slots: DriverDocumentSlot[]): number {
  return slots.filter((slot) => slot.document !== null).length;
}

/**
 * The sentence under the Submit button, and the reason there is one.
 *
 * A button reading *Submit for Review* on a screen where every row says "Not
 * sent yet" invites exactly one question — *can I even do that?* — and ADR-0048
 * §6's answer is yes. Saying so in one short line is cheaper than a driver
 * abandoning the form to go and find a document they did not need.
 *
 * i18n-safe in the sense PRODUCT.md asks for: whole sentences chosen by a
 * branch, never a sentence assembled from fragments and a number.
 */
export function submitFootnote(slots: DriverDocumentSlot[]): string {
  const sent = sentCount(slots);

  if (sent === 0) {
    return 'You can submit now and send your documents later. Nothing here is required.';
  }

  if (sent < slots.length) {
    return 'You can submit now and send the rest later.';
  }

  return 'Everything is in. The office checks each document by hand.';
}

/**
 * Which glyph a row draws, by document type.
 *
 * A **name**, resolved to a component by the list — this module stays free of
 * JSX so it can be unit-tested as data, the same split
 * `profile/presentation.ts` makes.
 *
 * Matching on `type` and never on `type_label`, for the reason
 * `NotificationsScreen` gives at length: a label is prose, prose gets
 * translated, and a screen that picks its icons by reading English breaks in
 * the first country that is not.
 *
 * **`null` is a real answer**, not a failure. The server's enum can gain a
 * case tomorrow and every installed handset must still draw the row; a
 * generic document glyph is what it falls back to, and the row is complete
 * without a bespoke one.
 */
export type DocumentGlyph =
  'contact' | 'scan-face' | 'id-card' | 'car' | 'shield-check' | 'car-front' | null;

export function documentGlyph(type: DriverDocumentType | string): DocumentGlyph {
  switch (type) {
    case 'identity_document':
      return 'contact';
    case 'identity_selfie':
      return 'scan-face';
    /*
     * The mockup draws a steering wheel here and **Lucide has no steering
     * wheel**. DESIGN.md §7 makes an absent glyph a design conversation
     * rather than a licence to draw one, so this is a deliberate
     * substitution and not a transcription miss — see `IdCardIcon`.
     */
    case 'driving_licence':
      return 'id-card';
    case 'vehicle_registration':
      return 'car';
    case 'vehicle_insurance':
      return 'shield-check';
    case 'vehicle_photo':
      return 'car-front';
    default:
      return null;
  }
}
