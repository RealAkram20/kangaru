import { describe, expect, it } from 'vitest'
import { CLIENT_MENU, FLEET_MENU, KANGARU_MENU, menuFor } from './index'
import { canUseNavLevel, filterSections } from '../navigation'
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
   * The three lists agree **except** where a level genuinely owns something.
   *
   * `K1` asserted they were identical, full stop. `K3` broke that on purpose
   * by giving Kangaru the fleet-company register — a fleet has no register of
   * its competitors, and a client has no view of the operators at all — so
   * the guard narrows rather than dies.
   *
   * The point it keeps: a divergence has to be **declared here**, in the
   * commit that creates it. `K4` removes twelve entries from `KANGARU_MENU`
   * and this turns red until they are named, which is the conversation that
   * should happen.
   */
  const LEVEL_ONLY = ['fleets']

  const shared = (sections: { items: { id: string }[] }[]) =>
    ids(sections).filter((id) => !LEVEL_ONLY.includes(id))

  it('offers the same destinations at every level, bar the ones a level owns', () => {
    expect(shared(FLEET_MENU)).toEqual(shared(KANGARU_MENU))
    expect(shared(CLIENT_MENU)).toEqual(shared(KANGARU_MENU))
  })

  it('gives the fleet register to head office and to nobody else', () => {
    expect(ids(KANGARU_MENU)).toContain('fleets')
    expect(ids(FLEET_MENU)).not.toContain('fleets')
    expect(ids(CLIENT_MENU)).not.toContain('fleets')
  })

  /**
   * The menu and the route must agree. A level that is offered the entry and
   * refused the page — or worse, hidden from the entry and served the page —
   * is the drift `canUseNavLevel` exists to prevent.
   */
  it('refuses the register to every level but head office, by URL as well', () => {
    expect(canUseNavLevel('kangaru', 'fleets')).toBe(true)
    expect(canUseNavLevel('fleet', 'fleets')).toBe(false)
    expect(canUseNavLevel('client', 'fleets')).toBe(false)
    expect(canUseNavLevel(undefined, 'fleets')).toBe(false)
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
