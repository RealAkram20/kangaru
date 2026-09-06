import { spriteFor, VEHICLE_SPRITES, type VehicleSprite } from './vehicleSprites';

/**
 * The silhouette a driver is drawn as.
 *
 * **The drift guard is not here.** This file's table and its four SVGs are
 * copies — of `PublicNearbyVehicleController::KINDS` and of
 * `frontend/public/assets/vehicles/*-top.svg` — and the worklog has recorded
 * twice what happens to a hand-mirrored list left to a comment asking the next
 * reader to keep it in step. Censusing that needs to read all three apps at
 * once, so it lives in `backend/tests/Feature/Ci/VehicleSpriteCensusTest.php`
 * beside the platform's other censuses; this app's `tsconfig` deliberately has
 * no Node types, and widening it so one test could read the filesystem would
 * let `fs` into a React Native bundle to buy nothing.
 *
 * What is left here is the behaviour that is genuinely this module's: the
 * fallback, and the shape the map document requires of the markup.
 */

describe('picking a silhouette', () => {
  it.each([
    ['boda', 'boda'],
    ['tricycle', 'boda'],
    ['sedan', 'sedan'],
    ['suv', 'suv'],
    ['van', 'suv'],
    ['minibus', 'suv'],
    ['bus', 'suv'],
    ['pickup', 'pickup'],
    ['truck', 'pickup'],
  ])('draws a %s as the %s', (category, sprite) => {
    expect(spriteFor(category)).toBe(sprite);
  });

  it('draws a generic car for a category this build has never heard of', () => {
    // `vehicle_categories` is a table an operator edits (ADR-0050), so a value
    // newer than this bundle is the expected case rather than a fault — and
    // the fallback is the server's own `?? 'sedan'`. A missing vehicle is the
    // same answer: a walk-in trip may carry none at all.
    expect(spriteFor('hovercraft')).toBe('sedan');
    expect(spriteFor(null)).toBe('sedan');
    expect(spriteFor(undefined)).toBe('sedan');
  });
});

describe('the artwork the map inlines', () => {
  const SPRITES: VehicleSprite[] = ['sedan', 'suv', 'pickup', 'boda'];

  it.each(SPRITES)('gives %s as a whole SVG document', (sprite) => {
    const markup = VEHICLE_SPRITES[sprite];

    // Whole, because the map document interpolates it straight into a marker
    // element — there is no asset loader in a WebView document built as a
    // string, which is exactly what keeps it drawing in a dead zone.
    expect(markup.startsWith('<svg')).toBe(true);
    expect(markup.endsWith('</svg>')).toBe(true);
  });

  it.each(SPRITES)('leaves %s sized by the map rather than by itself', (sprite) => {
    const markup = VEHICLE_SPRITES[sprite];

    // A viewBox and no width/height on the root: how big a marker is belongs
    // to the map, and a sprite carrying its own dimensions would ignore the
    // CSS that sets them.
    expect(markup).toContain('viewBox="0 0 512 512"');
    expect(/<svg[^>]*\swidth=/.test(markup)).toBe(false);
    expect(/<svg[^>]*\sheight=/.test(markup)).toBe(false);
  });

  it('gives each of the four a distinct drawing', () => {
    // Four keys pointing at one string would pass every other assertion here
    // and draw every driver as the same vehicle.
    expect(new Set(SPRITES.map((sprite) => VEHICLE_SPRITES[sprite])).size).toBe(SPRITES.length);
  });
});
