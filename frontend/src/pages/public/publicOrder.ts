import { apiClient } from '../../lib/apiClient'

/**
 * The visitor order form's contract with POST /api/v1/public/order-requests
 * (ADR-0012). Unauthenticated: apiClient simply has no token to attach.
 */
export type PublicService = 'ride' | 'delivery' | 'self_drive'

export interface PublicOrderPayload {
  service_type: PublicService
  contact_name: string
  contact_phone: string
  contact_email?: string
  pickup_location?: string
  dropoff_location?: string
  scheduled_for?: string
  notes?: string
  details?: Record<string, string | number | boolean>
  /** The honeypot. A human never fills it; the field is visually hidden. */
  website?: string
}

export async function submitPublicOrder(payload: PublicOrderPayload): Promise<string> {
  const response = await apiClient.post('/public/order-requests', payload)
  return response.data.data.reference as string
}

export const SERVICE_META: Record<
  PublicService,
  { label: string; description: string; short: string }
> = {
  ride: {
    label: 'Ride',
    description: 'Book taxis and boda bodas across Kampala.',
    short: 'Book taxis and boda bodas',
  },
  delivery: {
    label: 'Deliver',
    description: 'Send parcels, documents or cargo, boda to 10-tonne.',
    short: 'Send parcels, documents or cargo',
  },
  self_drive: {
    label: 'Self Drive',
    description: 'Rent a vehicle by the day and drive yourself.',
    short: 'Rent a vehicle and drive',
  },
}
