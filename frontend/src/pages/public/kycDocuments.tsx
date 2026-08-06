import { Camera, Car, IdCard, LifeBuoy, ScanFace, ShieldCheck } from 'lucide-react'

/**
 * The document checklist a KYC screen renders. Data, not a component, so
 * the same screen can serve a renter today and a captain signing up their
 * own vehicle later — the two ask for different papers, not different UI.
 */
export interface KycDocument {
  /** Travels with the order, so it is the server's vocabulary, not the label's. */
  id: string
  label: string
  icon: React.ReactNode
}

export interface KycSection {
  title: string
  documents: KycDocument[]
}

/** Which documents have been chosen, by document id. */
export type KycFiles = Record<string, string>

const PERSONAL_DOCUMENTS: KycDocument[] = [
  { id: 'national_id', label: 'National ID', icon: <IdCard className="h-5 w-5" aria-hidden /> },
  { id: 'selfie', label: 'Selfie', icon: <ScanFace className="h-5 w-5" aria-hidden /> },
]

const DRIVERS_LICENSE: KycDocument = {
  id: 'drivers_license',
  label: "Driver's License",
  icon: <LifeBuoy className="h-5 w-5" aria-hidden />,
}

/**
 * What a self-drive renter is asked for. National ID and selfie establish
 * who they are; the licence establishes that they may drive the thing away.
 *
 * The vehicle's own papers are deliberately not here. The renter is taking
 * one of our cars — they have never seen its logbook or its insurance, so
 * a row asking for either is a row nobody can ever satisfy. Those belong to
 * `CAPTAIN_KYC`, where the vehicle being signed up is the applicant's own.
 */
export const RENTAL_KYC: KycSection[] = [
  { title: 'Personal Information', documents: PERSONAL_DOCUMENTS },
  { title: 'Driver Information', documents: [DRIVERS_LICENSE] },
]

/**
 * What somebody signing their own vehicle up to the platform is asked for.
 * Unused until captain onboarding exists — kept here because it is the
 * other half of the same screen, and because the list is the only thing
 * that differs between the two.
 */
export const CAPTAIN_KYC: KycSection[] = [
  { title: 'Personal Information', documents: PERSONAL_DOCUMENTS },
  {
    title: 'Driver Information',
    documents: [
      DRIVERS_LICENSE,
      {
        id: 'vehicle_registration',
        label: 'Vehicle Registration',
        icon: <Car className="h-5 w-5" aria-hidden />,
      },
      {
        id: 'insurance_certificate',
        label: 'Insurance Certificate',
        icon: <ShieldCheck className="h-5 w-5" aria-hidden />,
      },
    ],
  },
  {
    title: 'Vehicle Information',
    documents: [
      {
        id: 'vehicle_photo',
        label: 'Vehicle Photo',
        icon: <Camera className="h-5 w-5" aria-hidden />,
      },
    ],
  },
]

/** Every listed document accounted for. */
export function kycComplete(sections: KycSection[], files: KycFiles): boolean {
  return sections.every((section) => section.documents.every((doc) => files[doc.id] !== undefined))
}
