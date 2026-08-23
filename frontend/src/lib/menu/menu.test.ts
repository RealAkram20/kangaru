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

describe('what each level is offered', () => {
  /**
   * The twelve entries `K4` took off head office's menu, and why each is
   * gone: every one of them is a fleet's operation or a fleet's register, and
   * ADR-0055 §2 leaves Kangaru reading none of it. They are **not hidden** —
   * they do not exist at this level, which is the difference between a locked
   * door and no door.
   *
   * Head office reaches all of it by acting as somebody at the fleet
   * (ADR-0056), which is announced, time-boxed and in `audit_logs`.
   */
  const FLEETS_OWN = [
    'bookings',
    'dispatch',
    'trips',
    'live-map',
    'routes',
    'companies',
    'vehicles',
    'drivers',
    'driver-applications',
    'support-requests',
    'invoices',
    'rate-cards',
  ]

  it('takes a fleet’s operations and registers off head office’s menu', () => {
    for (const id of FLEETS_OWN) expect(ids(KANGARU_MENU)).not.toContain(id)
  })

  /**
   * The other half, and the one that makes the first half safe: `K4` must not
   * quietly remove these from the level that actually runs them.
   */
  it('leaves every one of them where a fleet can still reach it', () => {
    for (const id of FLEETS_OWN) expect(ids(FLEET_MENU)).toContain(id)
  })

  it('gives the fleet register to head office and to nobody else', () => {
    expect(ids(KANGARU_MENU)).toContain('fleets')
    expect(ids(FLEET_MENU)).not.toContain('fleets')
    expect(ids(CLIENT_MENU)).not.toContain('fleets')
  })

  /**
   * Kangaru runs the walk-in economy directly — a walk-in has no contract and
   * no fleet behind it, so the queue and the customers are head office's own
   * work rather than somebody else's data.
   */
  it('keeps the walk-in economy with head office', () => {
    expect(ids(KANGARU_MENU)).toContain('walk-ins')
    expect(ids(KANGARU_MENU)).toContain('customers')
  })

  /**
   * The menu and the route must agree. A level offered the entry and refused
   * the page — or worse, hidden from the entry and served the page — is the
   * drift `canUseNavLevel` exists to prevent.
   */
  it('refuses the register to every level but head office, by URL as well', () => {
    expect(canUseNavLevel('kangaru', 'fleets')).toBe(true)
    expect(canUseNavLevel('fleet', 'fleets')).toBe(false)
    expect(canUseNavLevel('client', 'fleets')).toBe(false)
    expect(canUseNavLevel(undefined, 'fleets')).toBe(false)
  })

  /**
   * Both filters, in order (ADR-0059 §1). The **level** chooses the list and
   * the **role** narrows it, and this pins that the second still bites after
   * the first — a Dispatcher at a fleet gets the board, a Corporate Employee
   * whose level also lists it does not.
   */
  it('still narrows by role after the level has chosen the list', () => {
    const dispatcher = makeUser({ role: 'dispatcher', access_level: 'fleet', tenant_id: null })
    const employee = makeUser({ role: 'corporate_employee', access_level: 'client' })

    expect(ids(filterSections(menuFor(dispatcher.access_level), dispatcher))).toContain('dispatch')
    expect(ids(filterSections(menuFor(employee.access_level), employee))).not.toContain('dispatch')
  })

  /**
   * The whole point of `K4`, stated as one assertion: head office is offered
   * a short menu of what it owns, and a fleet keeps the long one.
   */
  it('offers head office far less than a fleet, which is the point', () => {
    const head = makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null })
    const owner = makeUser({ role: 'fleet_owner', access_level: 'fleet', tenant_id: null })

    const forHead = ids(filterSections(menuFor(head.access_level), head))
    const forFleet = ids(filterSections(menuFor(owner.access_level), owner))

    expect(forHead.length).toBeLessThan(forFleet.length)
    expect(forHead).toContain('fleets')
    expect(forFleet).not.toContain('fleets')
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
