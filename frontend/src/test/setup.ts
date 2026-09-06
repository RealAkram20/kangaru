import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/**
 * Runs before every test file.
 *
 * Everything here exists because jsdom is not a browser and the app is
 * written for one. Each entry is a specific thing the app calls that jsdom
 * does not implement — none of it is convenience.
 */

afterEach(() => {
  // Testing Library only auto-cleans when globals are on, and they are
  // deliberately off (see vite.config.ts). Without this, two tests in a
  // file both find the previous render's DOM and `getByRole` throws
  // "found multiple elements" — which reads as a component bug.
  cleanup()
  vi.restoreAllMocks()
})

/**
 * `Dialog` uses a native <dialog>, which jsdom ships without behaviour:
 * showModal/close exist on the prototype as undefined, so calling one is a
 * TypeError rather than a no-op. These give it just enough to open and
 * close, keeping the `open` attribute in step so queries can see inside it.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.show ??= function show(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

/**
 * `matchMedia` is absent from jsdom, and the app now asks it at what is
 * effectively every render: `Card`, `DataTable`, `Topbar`, `UserMenu` and
 * `PageFill` all read `useIsCompact()` to decide between the desktop console
 * and the phone layout.
 *
 * Reports **no match**, i.e. the desktop layout. That is the deliberate
 * default: these suites assert against tables, column headers and the docked
 * detail panel, and a stub that answered "compact" would render cards and
 * fail several hundred assertions for the wrong reason. A test that wants the
 * phone layout should stub this itself for that file.
 */
globalThis.matchMedia ??= ((query: string) =>
  ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    // Deprecated, but React and older libraries still feature-detect them.
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia

/** Not implemented in jsdom; several components observe their own size. */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * Also absent from jsdom, and reached through Animate UI: its icons call
 * `useIsInView` on every render to support `animateOnView`, whether or not a
 * caller asked for it. Without this the constructor throws, React unmounts
 * the subtree, and the failure surfaces somewhere else entirely — the KYC
 * step of the self-drive flow reported "unable to find a label", several
 * components away from the icon that actually blew up.
 *
 * Never reports an intersection, which is the right default: nothing in this
 * suite asserts on scroll-triggered animation, and a stub that fired would
 * start motion the tests would then have to wait out.
 */
globalThis.IntersectionObserver ??= class {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
} as unknown as typeof IntersectionObserver

/** Used by scroll-into-view behaviour in tables and dialogs. */
Element.prototype.scrollIntoView ??= function scrollIntoView() {}
