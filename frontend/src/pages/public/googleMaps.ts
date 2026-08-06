/// <reference types="google.maps" />

/**
 * Loading the Google Maps JS API, once per page.
 *
 * Google's SDK is a script tag, not an npm package — it must come from
 * maps.googleapis.com so the key, the billing and the terms all attach to
 * it. That means the usual dynamic `import()` the GL engines use is not
 * available, so this is a promise around a `<script>` the way
 * `SocialPrefill` already loads Google Identity Services.
 *
 * Everything is keyed on the singleton promise: two panels mounting at once
 * (the order form and the ride screen, mid-navigation) must not append two
 * script tags, which Google warns about and which double-bills nothing but
 * does throw.
 */

let loader: Promise<typeof google.maps> | null = null

export function googleMapsKey(): string | undefined {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY
}

/** True when Google is configured and usable in this environment. */
export function googleMapsAvailable(): boolean {
  // jsdom has no script loading worth the name, and CI has no key.
  return import.meta.env.MODE !== 'test' && Boolean(googleMapsKey())
}

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (loader !== null) return loader

  loader = new Promise((resolve, reject) => {
    const key = googleMapsKey()
    if (key === undefined || key === '') {
      reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set'))
      return
    }

    // Already present from a previous mount in this session.
    if (typeof google !== 'undefined' && google.maps?.Map !== undefined) {
      resolve(google.maps)
      return
    }

    const script = document.createElement('script')
    // `marker` for AdvancedMarkerElement, `geometry` for spherical maths.
    // `loading=async` is what Google asks for and silences its own warning.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      '&libraries=marker,geometry&loading=async&v=weekly'
    script.async = true
    script.onerror = () => reject(new Error('Google Maps failed to load'))
    script.onload = () => {
      if (typeof google === 'undefined' || google.maps?.Map === undefined) {
        reject(new Error('Google Maps loaded but exposed no Map'))
        return
      }
      resolve(google.maps)
    }
    document.head.appendChild(script)
  })

  // A failed load must not poison every later attempt — a flaky network on
  // first paint should not mean no map for the rest of the session.
  loader.catch(() => {
    loader = null
  })

  return loader
}
