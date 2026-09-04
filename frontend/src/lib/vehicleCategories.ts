import { useCallback, useEffect, useState } from 'react'
import { apiClient } from './apiClient'
import type { ApiSuccess } from '../types/api'
import type { VehicleCategory } from '../types/vehicleCategory'

/**
 * The one place the web app learns what vehicle categories exist (ADR-0050).
 *
 * ## Why this is a module and not four copies of a `useEffect`
 *
 * Before ADR-0050 the list was a literal, and the literal had been copied
 * into four files. Two of the copies had already drifted: `DriverFormDialog`
 * offered seven categories and omitted `boda` — on the form built so that a
 * rider arriving on their own boda could be onboarded — and
 * `types/vehicle.ts` typed `category` as the same seven, so a boda coming
 * back from the API did not type-check.
 *
 * Replacing a constant with four ad-hoc fetches would keep the shape of that
 * bug and only move where it lives. Every chooser reads this hook.
 *
 * ## There is deliberately no fallback list
 *
 * The obvious-looking move is to ship the nine known keys and use them when
 * the request fails. It is worse than it looks: the office can *retire* a
 * category, so a stale list offers choices the server answers 422 to — a
 * form that looks fine, submits, and is refused for a reason it cannot show.
 * `docs/screen-rules.md` §1 is the same instinct one level up: when the
 * platform cannot produce the answer, say so rather than substitute one.
 *
 * So a failed load is an error state that the caller renders, and the field
 * it feeds is disabled. Honest and, on a screen an operator uses a few times
 * a day, cheap.
 */
export interface VehicleCategoryList {
  /** Null until the first response settles — "loading", not "empty". */
  categories: VehicleCategory[] | null
  error: string | null
  reload: () => Promise<void>
}

export function useVehicleCategories(): VehicleCategoryList {
  const [categories, setCategories] = useState<VehicleCategory[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * A promise chain rather than `async`/`await`, so the state updates land
   * in a callback instead of running synchronously out of the effect body —
   * the shape `DriversPage` documents, and what `react-hooks/
   * set-state-in-effect` is about.
   *
   * The catch sets `[]` rather than leaving null: null means "still
   * loading", and a chooser that stays on "Loading…" forever after a failed
   * request is the worse of the two silences. `error` is what the caller
   * renders.
   */
  const reload = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<VehicleCategory[]>>('/vehicle-categories')
        .then((response) => {
          setCategories(response.data.data)
          setError(null)
        })
        .catch(() => {
          setCategories([])
          setError('Could not load vehicle categories.')
        }),
    [],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { categories, error, reload }
}

/**
 * The categories a chooser may offer: the active ones, in the office's
 * order, plus whichever one the record already carries.
 *
 * `alsoAllow` mirrors `ActiveVehicleCategory`'s server-side parameter
 * exactly, and for the same reason. A vehicle recorded as a tricycle before
 * the office retired tricycles must still be editable — otherwise a clerk
 * correcting its colour finds the category select has silently dropped the
 * value it is showing, and saving writes a different category than the one
 * on screen. Dropping the option is the more dangerous half of that: an
 * unmatched `<select>` value renders as the *first* option.
 */
export function categoryOptions(
  categories: VehicleCategory[],
  alsoAllow?: string | null,
): { value: string; label: string }[] {
  return categories
    .filter((category) => category.active || category.key === alsoAllow)
    .map((category) => ({
      value: category.key,
      // The retired one is labelled as retired rather than silently mixed
      // in, so a clerk can see why it is the only one of its kind here.
      label: category.active ? category.name : `${category.name} (retired)`,
    }))
}

/**
 * A stored key as the office says it — `suv` to "SUV".
 *
 * Falls back to the key itself, which is the honest answer for a category
 * that was deleted, and never a blank: a table cell that empties out when a
 * lookup misses reads as missing data rather than as an unknown label.
 */
export function categoryLabel(categories: VehicleCategory[] | null, key: string): string {
  return (categories ?? []).find((category) => category.key === key)?.name ?? key
}
