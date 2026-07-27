# UI kit — Enterprise web platform (Phase 1)

The operator-facing product: React + TypeScript + Vite + Tailwind + shadcn/ui in production.
Dark navy chrome, light content — the enterprise pattern set in DESIGN.md §2.

## Screens

| File | Screen | Notes |
|---|---|---|
| `LoginScreen.jsx` | Sign in + MFA step | Split navy/white. MFA required for Super Admin and Finance in Phase 1. |
| `DashboardScreen.jsx` | Operations dashboard | KPI row, live fleet map surface, dispatch queue, live/recent trips table. |
| `DispatchScreen.jsx` | Dispatch board | Booking queue → eligible drivers/vehicles → assignment dialog (pessimistic lock messaging). |
| `TripDetailScreen.jsx` | Trip record | The Bank's six required data points, odometer capture pair, billing preview, append-only timeline. |
| `BillingScreen.jsx` | Invoices | Rate-card lock notice, invoice table, credit-note dialog (issued invoices are never edited). |
| `shared.jsx` | Kit-local helpers | `MapSurface`, `VehiclePin`, `PageHead`, `FilterBar`. |

## Interactive path in index.html

Sign in → dashboard → click a trip row → trip record → sidebar to Dispatch → select a booking → assign → confirm → sidebar to Invoices → row menu → credit note.

## Deliberate omissions

- **Map tiles are not reproduced.** `MapSurface` is a labelled navy stand-in; the product renders Mapbox GL (route preview, GPS history, geofences). No fake roads or invented map art.
- Fleet, drivers, depots, reports, companies, audit-log and settings routes exist in the nav but are not built out — the brief's core operational path is what is modelled.
- Data is illustrative; amounts are integer UGX as the billing engine stores them.
