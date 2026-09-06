import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../../test/harness'
import type { VehicleAllocation } from '../../types/allocation'
import type { Company } from '../../types/company'
import { OrganisationView } from './OrganisationView'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 1,
    tenant_id: 1,
    legal_name: 'Centenary Bank Uganda Limited',
    trading_name: null,
    registration_number: null,
    industry: null,
    billing_email: 'transport-billing@centenarybank.test',
    phone: null,
    address_line1: null,
    address_line2: null,
    city: 'Kampala',
    country: 'Uganda',
    credit_limit_minor: 0,
    status: 'active',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function allocation(overrides: Partial<VehicleAllocation> = {}): VehicleAllocation {
  return {
    id: 1,
    tenant_id: 1,
    vehicle_id: 1,
    vehicle: {
      id: 1,
      registration_number: 'UIP 584O',
      make: 'Toyota',
      model: 'Hiace',
      year: 2026,
      category: 'van',
      seating_capacity: 14,
      color: null,
      vin: 'JTFHS02P900012345',
      status: 'active',
      created_at: '',
      updated_at: '',
    },
    starts_on: '2026-05-01',
    ends_on: null,
    exclusive: false,
    in_force: true,
    notes: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function serve(companies: Company[] | Error, allocations: VehicleAllocation[] | Error) {
  get.mockImplementation((url: string) => {
    const answer = url === '/companies' ? companies : allocations
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(apiOk(answer))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  serve([company()], [allocation()])
})

describe('OrganisationView', () => {
  it('shows the client their own profile, and never a credit limit', async () => {
    renderAs(<OrganisationView />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('Centenary Bank Uganda Limited')).toBeInTheDocument()
    expect(screen.getByText('transport-billing@centenarybank.test')).toBeInTheDocument()
    expect(screen.getByText('Kampala, Uganda')).toBeInTheDocument()
    // Recorded, audited, enforced by nothing: "UGX 0" would read as a fact
    // about their account (docs/screen-rules.md §1).
    expect(screen.queryByText(/credit limit/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/UGX/)).not.toBeInTheDocument()
  })

  it('lists the vehicles supplied to them without the VIN', async () => {
    renderAs(<OrganisationView />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('UIP 584O')).toBeInTheDocument()
    expect(screen.getByText('Toyota Hiace 2026')).toBeInTheDocument()
    expect(screen.getByText('Open-ended')).toBeInTheDocument()
    expect(screen.getByText('Shared')).toBeInTheDocument()
    expect(screen.getByText('In force')).toBeInTheDocument()
    expect(screen.queryByText('JTFHS02P900012345')).not.toBeInTheDocument()
  })

  it('names an exclusive, dated contract as such', async () => {
    serve([company()], [allocation({ exclusive: true, ends_on: '2027-05-31', in_force: false })])

    renderAs(<OrganisationView />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('Exclusive to you')).toBeInTheDocument()
    expect(screen.getByText('Not current')).toBeInTheDocument()
    expect(screen.queryByText('Open-ended')).not.toBeInTheDocument()
  })

  it('says so when no vehicle is contracted, rather than showing an empty grid', async () => {
    serve([company()], [])

    renderAs(<OrganisationView />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('No vehicles are contracted to you')).toBeInTheDocument()
  })

  it('fails one card at a time', async () => {
    serve(apiFailure(500, 'SERVER_ERROR', 'Down.'), [allocation()])

    renderAs(<OrganisationView />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText(/profile could not be loaded/i)).toBeInTheDocument()
    expect(await screen.findByText('UIP 584O')).toBeInTheDocument()
  })
})
