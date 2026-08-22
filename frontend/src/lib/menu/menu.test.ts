import { describe, expect, it } from 'vitest'
import { CLIENT_MENU, FLEET_MENU, KANGARU_MENU, menuFor } from './index'
import { filterSections } from '../navigation'
import { makeUser } from '../../test/harness'

/**
 * Which menu exists for a level, before role narrows it (ADR-0059 §1).
 *
 * `K1` ships the mechanism and nothing else: all three lists are identical
 * today, so these pin the *switch* rather than the contents. `K4` is what
 * makes them differ, and the last block below is the guard that will catch it
 * the moment it does.
 */
const ids = (sections: { items: { id: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.id))

describe('the menu a level gets', () => {
  it('gives each level its own list', () => {
    expect(menuFor('kangaru')).toBe(KANGARU_MENU)
    expect(menuFor('fleet')).toBe(FLEET_MENU)
    expect(menuFor('client')).toBe(CLIENT_MENU)
  })

  /**
   * ADR-0055 §4: an applicant's reach is keyed off their own id and
   * `AccessContext` leaves them unbound. They have a screen, not a console,
   * and a menu of destinations that all answer nothing would be a maze with
   * no exit.
   */
  it('gives an applicant no console at all', () => {
    expect(menuFor('applicant')).toEqual([])
  })

  /**
   * The one deliberate exception to failing closed, and the reason is in
   * `menuFor`: `access_level` is served by an API that may be older than the
   * field, every account today is `fleet` or `client`, and this runs in the
   * component that renders before anything else. Failing closed here blanks
   * the console for everybody on a stale deployment.
   *
   * Safe because it is not authorization — the worst case is a door that
   * answers 403, which the console already handles.
   */
  it.each([undefined, '', 'nonsense'])('falls back to the fleet menu for %o rather than to nothing', (level) => {
    expect(menuFor(level)).toBe(FLEET_MENU)
    expect(menuFor(level).length).toBeGreaterThan(0)
  })
})

describe('K1 changes nothing anybody can see', () => {
  /**
   * The binding constraint on this package. A change to the file every other
   * package wants to touch must not also change what people see, or a
   * regression in either is indistinguishable from the other.
   *
   * `K4` deletes twelve entries from `KANGARU_MENU` and this turns red. That
   * is the point: it should have to be deleted deliberately, in the commit
   * that makes the levels differ, rather than drifting apart unnoticed.
   */
  it('offers the same destinations at every level', () => {
    expect(ids(FLEET_MENU)).toEqual(ids(KANGARU_MENU))
    expect(ids(CLIENT_MENU)).toEqual(ids(KANGARU_MENU))
  })

  it('leaves role filtering exactly where it was', () => {
    const admin = makeUser({ role: 'super_admin', access_level: 'kangaru' })
    const employee = makeUser({ role: 'corporate_employee', access_level: 'client' })

    // The role rules still bite through the level lookup: a Corporate
    // Employee is not offered the dispatch board their level's list contains.
    expect(ids(filterSections(menuFor(admin.access_level), admin))).toContain('dispatch')
    expect(ids(filterSections(menuFor(employee.access_level), employee))).not.toContain('dispatch')
  })

  it('drops a section whose every item the role filtered away', () => {
    const employee = makeUser({ role: 'corporate_employee', access_level: 'client' })
    const labels = filterSections(menuFor(employee.access_level), employee).map((s) => s.label)

    // "Fleet" holds only vehicles, drivers, applications and driver reports,
    // and a client's people get none of them — so the heading must not
    // survive its own contents.
    expect(labels).not.toContain('Fleet')
  })
})
