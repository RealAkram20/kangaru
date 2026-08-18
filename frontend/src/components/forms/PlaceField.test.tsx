import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceHit } from '../../pages/public/places'

vi.mock('../../pages/public/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pages/public/places')>()),
  searchPlaces: vi.fn(),
}))

const { searchPlaces } = await import('../../pages/public/places')
const search = vi.mocked(searchPlaces)
const { PlaceField } = await import('./PlaceField')

const ACACIA: PlaceHit = {
  name: 'Acacia Mall',
  detail: 'Kira Road, Kampala',
  lngLat: [32.5825, 0.3476],
}

beforeEach(() => {
  vi.clearAllMocks()
  search.mockResolvedValue([ACACIA])
})

/**
 * ADR-0020 §2 in the operator console. A dispatcher raising a booking by
 * hand used to produce one with no coordinates, so the matcher reported
 * "pickup has no coordinates, so distance was not used" for every booking
 * staff created.
 */
function Harness({ onChange }: { onChange: (value: string, place: PlaceHit | null) => void }) {
  // A real controlled component: the earlier version pinned `value`, which
  // is not how the dialog uses it and left the input unable to change.
  const [value, setValue] = useState('Acacia')

  return (
    <PlaceField
      label="Pick-up"
      value={value}
      onChange={(next, place) => {
        setValue(next)
        onChange(next, place)
      }}
    />
  )
}

describe('PlaceField', () => {
  it('hands back the picked place alongside its label', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Harness onChange={onChange} />)

    // Suggestions only appear once the box is typed in — the hook refuses
    // to search text nobody entered.
    await user.type(screen.getByLabelText(/pick-up/i), 'x')
    // The button inside the option, not the li — `onMouseDown` lives there,
    // deliberately, because the input's blur would otherwise unmount the
    // list before a click could land.
    await user.click(await screen.findByRole('button', { name: /Acacia Mall/ }))

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('Acacia Mall, Kira Road', ACACIA),
    )
  })

  it('drops the picked place the moment the text is typed over', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Harness onChange={onChange} />)
    await user.type(screen.getByLabelText(/pick-up/i), 'x')

    // The second argument is null: typing invalidates any place that was
    // picked, so the caller stops sending coordinates that no longer
    // describe what the field says.
    expect(onChange).toHaveBeenLastCalledWith(expect.any(String), null)
  })

  it('does not search text the user never typed', async () => {
    render(<PlaceField label="Pick-up" value="Prefilled from somewhere" onChange={vi.fn()} />)

    // Otherwise filling the box programmatically would drop a suggestion
    // list over a field that was already settled.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(search).not.toHaveBeenCalled()
  })

  it('announces itself as a combobox so the list is reachable', async () => {
    const user = userEvent.setup()
    render(<Harness onChange={vi.fn()} />)

    const box = screen.getByRole('combobox', { name: /pick-up/i })
    expect(box).toHaveAttribute('aria-expanded', 'false')

    await user.type(box, 'x')
    await waitFor(() => expect(box).toHaveAttribute('aria-expanded', 'true'))
  })
})
