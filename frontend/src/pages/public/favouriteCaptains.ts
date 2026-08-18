/**
 * Captains the customer wants again.
 *
 * Kept on the device, in the same shape and for the same reason as the
 * recent destinations in `places.ts`: there is no endpoint to save them to.
 * A favourite is worth something the moment it is tapped — it survives the
 * session, it can be listed, and the button is not a lie — but it does not
 * follow the account to another phone until the backend can hold it.
 *
 * Keyed on the number plate. Names repeat, and a captain can change the car
 * they drive, but a plate identifies exactly one vehicle on the road, which
 * is the thing a passenger actually recognised and liked.
 *
 * What this does NOT do yet is influence dispatch. Requesting a favourite
 * captain by name means the matcher has to be able to prefer one — offer
 * them first, wait, then fall back — and that is a scheduling decision on a
 * matcher that does not exist. Until then this is a list the customer keeps.
 */

const KEY = 'kr.favourite-captains'
/** Enough to recognise them again, and nothing that is not already on screen. */
export interface FavouriteCaptain {
  name: string
  plate: string
  vehicle: string
  vehicleColour: string
}

function read(): FavouriteCaptain[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is FavouriteCaptain =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as FavouriteCaptain).plate === 'string' &&
        typeof (entry as FavouriteCaptain).name === 'string',
    )
  } catch {
    // Storage blocked or holding something else entirely: an empty list is
    // a truthful answer, and a thrown error here would take the ride screen
    // down over a nicety.
    return []
  }
}

export function favouriteCaptains(): FavouriteCaptain[] {
  return read()
}

export function isFavouriteCaptain(plate: string): boolean {
  return read().some((entry) => entry.plate === plate)
}

/** Adds or removes, and answers whether they are a favourite afterwards. */
export function toggleFavouriteCaptain(captain: FavouriteCaptain): boolean {
  const current = read()
  const already = current.some((entry) => entry.plate === captain.plate)
  const next = already
    ? current.filter((entry) => entry.plate !== captain.plate)
    : [captain, ...current]

  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Full or blocked. The caller still gets the answer it would have had,
    // so the button responds; it simply will not survive a reload.
  }
  return !already
}
