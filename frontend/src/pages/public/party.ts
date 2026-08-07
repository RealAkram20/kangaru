/**
 * The two ends of a parcel, as people rather than addresses.
 *
 * A ride carries the person who ordered it, so the account is the whole
 * answer. A delivery is not: the rider arrives at a gate and has to ask for
 * somebody by name, and the person handing the parcel over is often not the
 * person who booked it. So both ends are named, and either can be the
 * account holder.
 */
export interface Party {
  /** True when this end is the signed-in customer themselves. */
  isMe: boolean
  name: string
  phone: string
}

export const EMPTY_PARTY: Party = { isMe: false, name: '', phone: '' }

/**
 * Reachable: the rider must be able to ring whoever is not them. Nine
 * digits is the shortest Ugandan number that dials, and the same floor the
 * sign-up form and the server's `contact_phone` rule use.
 */
export function partyValid(party: Party): boolean {
  return party.isMe || (party.name.trim() !== '' && party.phone.trim().length >= 9)
}
