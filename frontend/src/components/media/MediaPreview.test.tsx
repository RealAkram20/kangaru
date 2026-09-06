import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAs } from '../../test/harness'
import { MediaPreview } from './MediaPreview'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)

const OBJECT_URL = 'blob:http://localhost/fake-object-url'

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue({ data: new Blob(['bytes']) })

  // jsdom implements neither, and both are the thing under test.
  URL.createObjectURL = vi.fn(() => OBJECT_URL)
  URL.revokeObjectURL = vi.fn()
})

const IMAGE = {
  url: '/drivers/3/documents/11/file',
  mimeType: 'image/jpeg',
  name: 'licence.jpg',
  sizeBytes: 240_000,
  title: 'Driving licence',
}

/**
 * ADR-0048 — the shared previewer.
 *
 * The two claims worth defending are both about *not* doing something: it
 * never points an `<img src>` at an authenticated route, and it never renders
 * a type it cannot actually display.
 */
describe('MediaPreview', () => {
  it('fetches the bytes with the session rather than linking to the route', async () => {
    renderAs(<MediaPreview source={IMAGE} onClose={() => {}} />)

    // Not `toHaveBeenCalledTimes(1)`: the harness renders under `StrictMode`,
    // which mounts, unmounts and remounts every effect on purpose. Two calls
    // here is the framework doing its job — and the double-mount is exactly
    // what the `revoked` guard in the effect exists to survive, so asserting
    // a single call would be asserting that StrictMode is switched off.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/drivers/3/documents/11/file', { responseType: 'blob' }),
    )

    const image = await screen.findByAltText('licence.jpg')

    /**
     * **The object URL, never the API path.**
     *
     * ADR-0033 §5 keeps these files behind authentication precisely so a URL
     * alone is not enough. An `<img>` pointed at the route sends no bearer and
     * renders a 401 where somebody's identity document should be — which looks
     * exactly like a broken image, so nobody would report it as a bug.
     */
    expect(image).toHaveAttribute('src', OBJECT_URL)
  })

  it('revokes the object URL when it closes, not on a timer', async () => {
    const { unmount } = renderAs(<MediaPreview source={IMAGE} onClose={() => {}} />)

    await screen.findByAltText('licence.jpg')
    unmount()

    // The handle is to somebody's identity document held in this tab's memory.
    // Leaving it alive after the dialog closes is a window in which a script
    // on the page can still read it.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
  })

  it('zooms and rotates without touching anything but the transform', async () => {
    const user = userEvent.setup()
    renderAs(<MediaPreview source={IMAGE} onClose={() => {}} />)

    const image = await screen.findByAltText('licence.jpg')
    expect(image).toHaveStyle({ transform: 'translate(0px, 0px) scale(1) rotate(0deg)' })

    await user.click(screen.getByRole('button', { name: /zoom in/i }))
    await user.click(screen.getByRole('button', { name: /rotate right/i }))

    // `transform` only — DESIGN.md allows transform and opacity and nothing
    // else, so zooming stays on the compositor rather than triggering layout
    // on a full-page image.
    expect(image).toHaveStyle({ transform: 'translate(0px, 0px) scale(1.25) rotate(90deg)' })

    await user.click(screen.getByRole('button', { name: /fit/i }))
    expect(image).toHaveStyle({ transform: 'translate(0px, 0px) scale(1) rotate(0deg)' })
  })

  it('renders a PDF in the browser viewer, with no library and no image tag', async () => {
    renderAs(
      <MediaPreview
        source={{ ...IMAGE, mimeType: 'application/pdf', name: 'insurance.pdf' }}
        onClose={() => {}}
      />,
    )

    const frame = await screen.findByTitle('insurance.pdf')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', OBJECT_URL)

    // No zoom toolbar: the browser's own PDF viewer draws one inside the
    // frame, and a second set of controls that did nothing to it would be
    // worse than none.
    expect(screen.queryByRole('button', { name: /zoom in/i })).not.toBeInTheDocument()
  })

  it('refuses to render an SVG as an image', async () => {
    renderAs(
      <MediaPreview
        source={{ ...IMAGE, mimeType: 'image/svg+xml', name: 'clever.svg' }}
        onClose={() => {}}
      />,
    )

    /**
     * `image/*` would have matched this. An SVG is a script host, and
     * rendering one that arrived from an unprivileged uploader inside the
     * console is a stored-XSS surface even through an object URL — so the
     * allow-list is the exact list the upload accepts and no wider.
     */
    expect(await screen.findByText(/cannot be shown here/i)).toBeInTheDocument()
    expect(screen.queryByAltText('clever.svg')).not.toBeInTheDocument()
  })

  it('says so plainly when the file cannot be loaded', async () => {
    get.mockRejectedValue(new Error('gone'))

    renderAs(<MediaPreview source={IMAGE} onClose={() => {}} />)

    // An empty frame is indistinguishable, to the person looking at it, from a
    // document that was never uploaded.
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
  })
})
