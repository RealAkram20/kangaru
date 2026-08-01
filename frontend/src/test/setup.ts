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

/** Not implemented in jsdom; several components observe their own size. */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Used by scroll-into-view behaviour in tables and dialogs. */
Element.prototype.scrollIntoView ??= function scrollIntoView() {}
