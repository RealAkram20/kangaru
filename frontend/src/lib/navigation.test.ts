import { describe, expect, it } from 'vitest'
import { makeUser } from '../test/harness'
import { canUseNavItem, filterSections, isCorporateRole, navLabel } from './navigation'

/**
 * What a corporate client's people are offered in the menu.
 *
 * Centenary Bank is a client of Shanitah General Enterprises Ltd, not an
 * operator: it owns no vehicle and no driver (ADR-0005). Its transport
 * officer manages their own staff, requests and approves bookings, and
 * reads their own trips, invoices and reports — and must not be handed the
 * fleet register, whose driver rows carry every driver's phone and licence
 * number (docs/security-gate.md F2). These pin that split.
 */
describe('the corporate client menu', () => {
  const FLEET = ['vehicles', 'drivers', 'driver-applications', 'support-requests']

  it.each(['corporate_admin', 'corporate_employee'])('hides every fleet entry from %s', (role) => {
    for (const id of FLEET) expect(canUseNavItem(role, id)).toBe(false)
  })

  it.each(['super_admin', 'operations_manager', 'dispatcher', 'fleet_owner', 'branch_manager', 'depot_manager'])(
    'keeps every fleet entry for %s',
    (role) => {
      for (const id of FLEET) expect(canUseNavItem(role, id)).toBe(true)
    },
  )

  it("leaves a corporate admin exactly what the owner listed, and nothing of the operator's", () => {
    for (const id of ['dashboard', 'bookings', 'trips', 'live-map', 'companies', 'invoices', 'reports', 'staff', 'notifications']) {
      expect(canUseNavItem('corporate_admin', id)).toBe(true)
    }
    // Owner, 2026-08-19: the role catalogue, the pricing tables and the
    // audit feed are the platform's, and are not doors in a client's menu.
    for (const id of ['roles', 'rate-cards', 'audit-log']) {
      expect(canUseNavItem('corporate_admin', id)).toBe(false)
    }
  })

  it('leaves a corporate employee only what they use to request and follow a ride', () => {
    for (const id of ['bookings', 'trips', 'live-map', 'notifications', 'dashboard']) {
      expect(canUseNavItem('corporate_employee', id)).toBe(true)
    }
    for (const id of ['companies', 'staff', 'invoices', 'rate-cards', 'reports', 'dispatch', 'customers']) {
      expect(canUseNavItem('corporate_employee', id)).toBe(false)
    }
  })

  it('never offers the operator\'s dispatch, walk-ins or customers to a client', () => {
    for (const role of ['corporate_admin', 'corporate_employee']) {
      for (const id of ['dispatch', 'walk-ins', 'customers', 'system-settings']) {
        expect(canUseNavItem(role, id)).toBe(false)
      }
    }
  })
})

describe('navLabel', () => {
  it('calls the client\'s own company page "Organisation", and the operator\'s "Companies"', () => {
    expect(navLabel('corporate_admin', 'companies', 'Companies')).toBe('Organisation')
    expect(navLabel('corporate_employee', 'companies', 'Companies')).toBe('Organisation')
    expect(navLabel('super_admin', 'companies', 'Companies')).toBe('Companies')
    expect(navLabel('dispatcher', 'companies', 'Companies')).toBe('Companies')
  })

  it('leaves every other label alone', () => {
    expect(navLabel('corporate_admin', 'staff', 'Staff')).toBe('Staff')
    expect(navLabel(undefined, 'companies', 'Companies')).toBe('Companies')
  })
})

describe('filterSections', () => {
  const SECTIONS = [
    { items: [{ id: 'dashboard', label: 'Dashboard' }] },
    {
      label: 'Operations',
      items: [
        { id: 'bookings', label: 'Bookings' },
        { id: 'companies', label: 'Companies' },
      ],
    },
    {
      label: 'Fleet',
      items: [
        { id: 'vehicles', label: 'Vehicles' },
        { id: 'drivers', label: 'Drivers' },
      ],
    },
  ]

  it('drops the whole Fleet section for a corporate admin and relabels their company', () => {
    const sections = filterSections(SECTIONS, makeUser({ role: 'corporate_admin' }))

    expect(sections.map((s) => s.label)).toEqual([undefined, 'Operations'])
    expect(sections[1].items.map((i) => i.label)).toEqual(['Bookings', 'Organisation'])
  })

  it('keeps everything, unrelabelled, for the platform owner', () => {
    const sections = filterSections(SECTIONS, makeUser({ role: 'super_admin', tenant_id: null, tenant_name: null }))

    expect(sections.map((s) => s.label)).toEqual([undefined, 'Operations', 'Fleet'])
    expect(sections[1].items.map((i) => i.label)).toEqual(['Bookings', 'Companies'])
  })
})

describe('isCorporateRole', () => {
  it('names exactly the two client roles', () => {
    expect(isCorporateRole('corporate_admin')).toBe(true)
    expect(isCorporateRole('corporate_employee')).toBe(true)
    expect(isCorporateRole('super_admin')).toBe(false)
    expect(isCorporateRole('driver')).toBe(false)
    expect(isCorporateRole(undefined)).toBe(false)
  })
})

describe('capabilities widen the client menu', () => {
  it('opens Invoices and Reports to an employee switched on to see finance, and Staff to one who manages staff', () => {
    expect(canUseNavItem('corporate_employee', 'invoices')).toBe(false)
    expect(canUseNavItem('corporate_employee', 'invoices', ['sees_finance'])).toBe(true)
    expect(canUseNavItem('corporate_employee', 'reports', ['sees_finance'])).toBe(true)
    expect(canUseNavItem('corporate_employee', 'staff', ['manages_staff'])).toBe(true)
    // Approving opens nothing new — Bookings is already theirs.
    expect(canUseNavItem('corporate_employee', 'staff', ['approves_bookings'])).toBe(false)
  })

  it('never opens the fleet, and never widens a non-client role', () => {
    expect(canUseNavItem('corporate_employee', 'drivers', ['sees_finance', 'manages_staff', 'approves_bookings'])).toBe(false)
    expect(canUseNavItem('driver', 'invoices', ['sees_finance'])).toBe(false)
    expect(canUseNavItem('dispatcher', 'staff', ['manages_staff'])).toBe(false)
  })

  it('reads them off the signed-in user when filtering sections', () => {
    const sections = filterSections(
      [{ label: 'Finance', items: [{ id: 'invoices', label: 'Invoices' }] }],
      makeUser({ role: 'corporate_employee', capabilities: ['sees_finance'] }),
    )
    expect(sections[0]?.items.map((i) => i.id)).toEqual(['invoices'])
  })
})
