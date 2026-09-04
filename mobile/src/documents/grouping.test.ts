import type { DriverDocumentSlot } from '../api/endpoints';
import { documentGlyph, groupSlots, sentCount, submitFootnote } from './grouping';

/**
 * The KYC screen's grouping, as data.
 *
 * Pure functions with tests rather than expressions inside the screen, for the
 * reason `profile/presentation.ts` gives: an inline helper has no test, and
 * this app has already shipped one of those that divided a zero-decimal
 * currency by a hundred.
 */
function slot(overrides: Partial<DriverDocumentSlot> = {}): DriverDocumentSlot {
  return {
    type: 'identity_document',
    type_label: 'Identity document',
    hint: 'A national ID, passport, or whatever your country issues.',
    requires_expiry: false,
    group: 'personal',
    group_label: 'Personal information',
    document: null,
    ...overrides,
  };
}

describe('groupSlots', () => {
  it('splits the mockup three sections, in the order the server sent them', () => {
    const sections = groupSlots([
      slot({ type: 'identity_document' }),
      slot({ type: 'identity_selfie' }),
      slot({ type: 'driving_licence', group: 'driver', group_label: 'Driver information' }),
      slot({ type: 'vehicle_photo', group: 'vehicle', group_label: 'Vehicle information' }),
    ]);

    expect(sections.map((section) => section.label)).toEqual([
      'Personal information',
      'Driver information',
      'Vehicle information',
    ]);
    expect(sections[0]?.slots).toHaveLength(2);
  });

  /**
   * The property that lets a seventh document type reach every installed
   * handset correctly placed, with no release: the client holds no list of
   * group names and no ordering of its own.
   */
  it('draws a group it has never heard of, with the server heading', () => {
    const sections = groupSlots([
      slot({ type: 'identity_document' }),
      slot({
        type: 'psv_badge' as DriverDocumentSlot['type'],
        group: 'operator',
        group_label: 'Operator information',
      }),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[1]?.label).toBe('Operator information');
  });

  it('never reorders, so a broken payload fails where somebody can see it', () => {
    const sections = groupSlots([
      slot({ type: 'identity_document' }),
      slot({ type: 'vehicle_photo', group: 'vehicle', group_label: 'Vehicle information' }),
      slot({ type: 'identity_selfie' }),
    ]);

    // Two personal sections rather than a silent merge that reorders the
    // office's reading order behind everyone's back.
    expect(sections.map((section) => section.group)).toEqual(['personal', 'vehicle', 'personal']);
  });

  it('returns nothing for nothing, rather than an empty section', () => {
    expect(groupSlots([])).toEqual([]);
  });
});

describe('sentCount', () => {
  /**
   * A rejected document *was* sent. Counting only the accepted ones would tell
   * somebody they have sent three of six when one was refused — a second,
   * quieter lie on top of the rejection already on the row.
   */
  it('counts anything the office is holding, whatever state it is in', () => {
    const held = { compliance_state: 'rejected' } as NonNullable<DriverDocumentSlot['document']>;

    expect(sentCount([slot({ document: held }), slot(), slot()])).toBe(1);
  });
});

describe('submitFootnote', () => {
  it('says nothing is required when nothing has been sent', () => {
    expect(submitFootnote([slot(), slot()])).toContain('Nothing here is required');
  });

  it('offers to take the rest later when some are in', () => {
    const held = {} as NonNullable<DriverDocumentSlot['document']>;

    expect(submitFootnote([slot({ document: held }), slot()])).toContain('send the rest later');
  });

  it('stops offering when the set is complete', () => {
    const held = {} as NonNullable<DriverDocumentSlot['document']>;

    expect(submitFootnote([slot({ document: held })])).toContain('Everything is in');
  });
});

describe('documentGlyph', () => {
  it('gives each of the six its own shape', () => {
    const glyphs = [
      'identity_document',
      'identity_selfie',
      'driving_licence',
      'vehicle_registration',
      'vehicle_insurance',
      'vehicle_photo',
    ].map((type) => documentGlyph(type));

    expect(new Set(glyphs).size).toBe(6);
    expect(glyphs).not.toContain(null);
  });

  /**
   * `null` is a real answer. The server's enum can gain a case tomorrow and
   * every installed app must still draw the row — the list falls back to a
   * generic document glyph rather than rendering nothing.
   */
  it('answers null for a type it has never heard of', () => {
    expect(documentGlyph('psv_badge')).toBeNull();
  });
});
