# UI kit — Marketing website & booking flow

Public site plus the browser booking flow. The user named Uber's site
(uber.com/ug/en, m.uber.com/go/home) as *inspiration* for the pattern — a hero
with an inline pickup/destination panel, a vehicle-class picker with prices, and
a live-tracking view. Nothing is copied from it: all type, colour, layout and
copy are KangaruRide's own.

## Screens

| File | Screen |
|---|---|
| `shared.jsx` | `SiteHeader`, `SiteFooter`, `Section` shell |
| `HomeScreen.jsx` | Navy hero + booking panel, value-prop grid, how-it-works, vehicle categories, closing CTA |
| `BookingScreen.jsx` | 3-step flow: choose a vehicle → confirm details (cost centre) → track driver |

## Deliberate omissions

- **No brand photography was supplied.** Full-bleed sections use the navy brand surface rather than invented imagery. When real photography exists, drop it into the hero and the "How it works" band; keep the lockup on a solid plate, never straight on the image.
- Map areas are labelled Mapbox stand-ins.
- Marketplace surfaces (taxi, boda boda, self drive, van/truck hire) are Phase 4 and intentionally absent.
