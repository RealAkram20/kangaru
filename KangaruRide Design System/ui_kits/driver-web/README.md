# UI kit — Driver web flow (Phase 1)

Phase 1 gives drivers a **mobile-responsive web flow**, not a native app (Phase 2).
Rendered at 390px inside a light frame so it reads as a phone surface.

`DriverFlow.jsx` walks the full trip lifecycle, one stage per screen:

assigned → accepted / en route → arrived → start (opening odometer + dashboard photo)
→ in progress (waiting toggle) → complete (closing odometer + photo, variance warning) → done

Tap the wifi button in the header to switch to the offline state: captures queue
locally and sync when the vehicle reconnects.

## Rules honoured here

- Every control is at least 44px tall (`size="lg"`).
- Odometer entry is mono + suffixed; the reading is data, not prose.
- Variance between odometer and GPS distance is surfaced to the driver, not hidden.
- Reject and no-show are available but marked as recorded against the driver.
