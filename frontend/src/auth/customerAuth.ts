import { isAxiosError } from 'axios'
import {
  apiClient,
  clearStoredCustomerToken,
  getStoredCustomerToken,
  storeCustomerToken,
} from '../lib/apiClient'

/**
 * The walk-in customer's own account (ADR-0013 §3, ADR-0015). A separate
 * principal from the staff `useAuth` session in every way that matters:
 * its own token, its own storage key, its own guard on the server. The
 * two can be signed in at once on a shared terminal without either
 * standing in for the other.
 */

export type CustomerGender = 'female' | 'male' | 'other' | 'prefer_not_to_say'

export const GENDER_OPTIONS: { value: CustomerGender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

export interface Customer {
  id: number
  first_name: string
  last_name: string
  /** Composed server-side, so the join has exactly one spelling. */
  name: string
  gender: CustomerGender | null
  phone: string
  email: string
  created_at: string | null
}

export interface CustomerRegistration {
  first_name: string
  last_name: string
  gender?: CustomerGender | null
  phone: string
  email: string
  password: string
}

/** Raised when the server rejected specific fields, keyed as the form names them. */
export class CustomerValidationError extends Error {
  // Assigned in the body rather than declared as a constructor parameter
  // property: `erasableSyntaxOnly` is on, and a parameter property is
  // syntax that has to be compiled away rather than simply erased.
  readonly errors: Record<string, string>

  constructor(errors: Record<string, string>) {
    super('The details you entered need a correction.')
    this.name = 'CustomerValidationError'
    this.errors = errors
  }
}

function fieldErrors(error: unknown): Record<string, string> | null {
  if (!isAxiosError(error) || error.response?.status !== 422) return null
  const raw: Record<string, string[]> = error.response.data.errors ?? {}
  return Object.fromEntries(Object.entries(raw).map(([key, messages]) => [key, messages[0]]))
}

export async function registerCustomer(payload: CustomerRegistration): Promise<Customer> {
  try {
    const response = await apiClient.post('/customer/auth/register', payload)
    storeCustomerToken(response.data.data.token as string)
    return response.data.data.customer as Customer
  } catch (error) {
    const errors = fieldErrors(error)
    if (errors !== null) throw new CustomerValidationError(errors)
    throw error
  }
}

export async function loginCustomer(email: string, password: string): Promise<Customer> {
  try {
    const response = await apiClient.post('/customer/auth/login', { email, password })
    storeCustomerToken(response.data.data.token as string)
    return response.data.data.customer as Customer
  } catch (error) {
    const errors = fieldErrors(error)
    if (errors !== null) throw new CustomerValidationError(errors)
    throw error
  }
}

/**
 * Resolves the stored token to an account, or null. Never throws: a token
 * that has expired or been revoked simply means signed out, and the
 * caller is a page that must still render for someone with no account
 * at all.
 */
export async function fetchCustomer(): Promise<Customer | null> {
  if (getStoredCustomerToken() === null) return null
  try {
    const response = await apiClient.get('/customer/auth/me')
    return response.data.data as Customer
  } catch {
    clearStoredCustomerToken()
    return null
  }
}

export async function logoutCustomer(): Promise<void> {
  try {
    await apiClient.post('/customer/auth/logout')
  } catch {
    // Best effort. The token is being thrown away locally either way, and
    // failing to reach the server is not a reason to leave someone
    // looking signed in on their own device.
  }
  clearStoredCustomerToken()
}

export { getStoredCustomerToken }
