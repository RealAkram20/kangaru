import { describe, expect, it } from 'vitest'
import { coordinatesFor, withCoordinateErrorsOnTheirFields } from './orderCoordinates'
import type { PlaceHit } from './places'

/**
 * ADR-0020 §2 — the rule deciding whether a picked place's coordinates
 * still describe what the field says.
 *
 * Tested directly rather than through the order flow, because the flow
 * cannot express every case: once the device supplies the pickup, that
 * field is rendered as text rather than an editable input, so "type over a
 * picked place" is unreachable there. A test that pretended otherwise would
 * assert nothing.
 */
const picked: PlaceHit = {
  name: 'Acacia Mall',
  detail: 'Kira Road, Kampala',
  lngLat: [32.5825, 0.3476],
}

describe('coordinatesFor', () => {
  it('sends the pair when the text still matches the picked place', () => {
    expect(coordinatesFor('Acacia Mall, Kira Road', picked, 'lat', 'lng')).toEqual({
      // `lngLat` is [lng, lat]; swapping them puts a Kampala pickup off the
      // coast of Ghana with both values still in valid range, which no
      // server-side rule can catch.
      lat: 0.3476,
      lng: 32.5825,
    })
  })

  it('sends nothing once the text has been edited away from it', () => {
    // Somebody who picks a place and then types over it has moved the pin in
    // their head. Sending the old coordinates would dispatch a driver to the
    // wrong side of a building with more confidence than the text deserves.
    expect(coordinatesFor('Acacia Mall, gate 3', picked, 'lat', 'lng')).toEqual({})
  })

  it('sends nothing when the geocoder gave no position', () => {
    const noFix: PlaceHit = { name: 'Acacia Mall', detail: 'Kira Road, Kampala' }

    expect(coordinatesFor('Acacia Mall, Kira Road', noFix, 'lat', 'lng')).toEqual({})
  })

  it('sends nothing when nothing was picked at all', () => {
    expect(coordinatesFor('Somewhere I typed', null, 'lat', 'lng')).toEqual({})
  })

  it('handles the device fix, whose label is its detail rather than its name', () => {
    // The trap this rule fell into first: a device fix is stored as
    // `{name: 'Current location', detail: 'Plot 9, Bukoto Street'}` and the
    // field is filled with the detail. Comparing `name` dropped the
    // coordinates for every order placed from the phone's own position —
    // which is most of them.
    const deviceFix: PlaceHit = {
      name: 'Current location',
      detail: 'Plot 9, Bukoto Street, Kampala',
      lngLat: [32.5825, 0.3476],
    }

    expect(coordinatesFor('Plot 9, Bukoto Street, Kampala', deviceFix, 'lat', 'lng')).toEqual({
      lat: 0.3476,
      lng: 32.5825,
    })
  })

  it('ignores surrounding whitespace, which a paste often carries', () => {
    expect(coordinatesFor('  Acacia Mall, Kira Road  ', picked, 'lat', 'lng')).toEqual({
      lat: 0.3476,
      lng: 32.5825,
    })
  })
})

describe('withCoordinateErrorsOnTheirFields', () => {
  it('shows a coordinate rejection on the address field the customer can edit', () => {
    // The service-area check rejects `pickup_latitude`, and no such input
    // exists — the customer types an address. Without this the form sends
    // them back with nothing visibly wrong (ADR-0021).
    const mapped = withCoordinateErrorsOnTheirFields({
      pickup_latitude: ['That pickup is outside the area we cover.'],
    })

    expect(mapped.pickup_location).toBe('That pickup is outside the area we cover.')
  })

  it('leaves an error already on the address field alone', () => {
    // A rejection of the address itself is the more actionable of the two.
    const mapped = withCoordinateErrorsOnTheirFields({
      pickup_location: ['Please tell us where we should pick up.'],
      pickup_latitude: ['That pickup is outside the area we cover.'],
    })

    expect(mapped.pickup_location).toBe('Please tell us where we should pick up.')
  })

  it('passes ordinary errors through untouched', () => {
    const mapped = withCoordinateErrorsOnTheirFields({
      contact_phone: ['That phone number is not valid.'],
    })

    expect(mapped).toEqual({ contact_phone: 'That phone number is not valid.' })
  })
})
