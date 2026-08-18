import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  favouriteCaptains,
  isFavouriteCaptain,
  toggleFavouriteCaptain,
} from './favouriteCaptains'

const MOSES = {
  name: 'Moses Kirabo',
  plate: 'UBH 421K',
  vehicle: 'Toyota Vitz',
  vehicleColour: 'White',
}
const GRACE = {
  name: 'Grace Atim',
  plate: 'UAX 907P',
  vehicle: 'Nissan Note',
  vehicleColour: 'Blue',
}

beforeEach(() => {
  localStorage.clear()
})

describe('favouriteCaptains', () => {
  it('starts empty and knows nobody', () => {
    expect(favouriteCaptains()).toEqual([])
    expect(isFavouriteCaptain(MOSES.plate)).toBe(false)
  })

  it('saves a captain and answers that it did', () => {
    expect(toggleFavouriteCaptain(MOSES)).toBe(true)

    expect(isFavouriteCaptain(MOSES.plate)).toBe(true)
    expect(favouriteCaptains()).toHaveLength(1)
    expect(favouriteCaptains()[0]).toMatchObject({ name: 'Moses Kirabo', plate: 'UBH 421K' })
  })

  it('removes on a second tap rather than saving twice', () => {
    toggleFavouriteCaptain(MOSES)
    expect(toggleFavouriteCaptain(MOSES)).toBe(false)

    expect(isFavouriteCaptain(MOSES.plate)).toBe(false)
    expect(favouriteCaptains()).toEqual([])
  })

  it('keeps the most recently saved captain first', () => {
    toggleFavouriteCaptain(MOSES)
    toggleFavouriteCaptain(GRACE)

    expect(favouriteCaptains().map((c) => c.plate)).toEqual([GRACE.plate, MOSES.plate])
  })

  it('identifies by plate, so two captains sharing a name both survive', () => {
    // Names repeat. A plate is one vehicle on the road, which is the thing
    // the passenger actually recognised.
    toggleFavouriteCaptain(MOSES)
    toggleFavouriteCaptain({ ...GRACE, name: 'Moses Kirabo' })

    expect(favouriteCaptains()).toHaveLength(2)
  })

  it('treats junk in storage as an empty list rather than throwing', () => {
    // The ride screen must not come down because something else wrote here.
    localStorage.setItem('kr.favourite-captains', '{"not":"an array"}')
    expect(favouriteCaptains()).toEqual([])

    localStorage.setItem('kr.favourite-captains', 'not json at all')
    expect(favouriteCaptains()).toEqual([])
  })

  it('still answers the caller when storage refuses to save', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    // The button must respond even though nothing will survive a reload.
    expect(toggleFavouriteCaptain(MOSES)).toBe(true)
    setItem.mockRestore()
  })
})
