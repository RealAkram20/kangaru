# KangaruRide Design System

Enterprise Transport Management & Fleet Operations Platform
Owner: **Shanitah General Enterprises Ltd** · Kampala, Uganda · Phase 1 build, v1.1

---

## 1. Product context

KangaruRide modernises corporate fleet operations: booking, dispatch, trip lifecycle,
GPS tracking, odometer capture, rate-card billing, reporting and audit. It is
multi-tenant from day one — corporates, government, NGOs, fleet owners, logistics
companies — with individual customers and a transport marketplace in later phases.

The anchor client is **Centenary Bank** (ref CRDB/CS/F/26, 22 July 2026). Their six
required per-trip data points are the formal Phase 1 acceptance criteria and appear
on every trip record and trip report:

1. Date and time of commencement and completion
2. Vehicle registration
3. Origin and destination
4. Opening and closing odometer readings
5. Total distance travelled
6. Trip duration

Design consequence: **the trip record is the product's centre of gravity.** Screens
exist to make that record complete, verifiable and billable — not to look busy.

### Surfaces represented here

| Surface | Status | UI kit |
|---|---|---|
| Enterprise web platform (operators, finance, admin) | Phase 1 — built | `ui_kits/platform/` |
| Marketing website + browser booking flow | Phase 1 | `ui_kits/website/` |
| Driver mobile-responsive web flow | Phase 1 (native app is Phase 2) | `ui_kits/driver-web/` |
| Corporate employee mobile app | Phase 3 | not designed |
| Marketplace (taxi, boda, self drive, hire) | Phase 4 | not designed |

Production stack: React, TypeScript, Vite, Tailwind CSS, shadcn/ui · Laravel 12 / PHP 8.4 ·
MySQL 8 · Redis · Mapbox · Laravel Reverb · Cloudflare R2.

### Sources used to build this system

Everything below was supplied by the user as files in `uploads/`. **No codebase, Figma
file or repository was provided**, so component implementations are authored from the
written specification rather than recreated from source.

- `uploads/PROJECT.md` — product brief: modules, roles, trip lifecycle, NFRs, roadmap.
- `uploads/DESIGN.md` — the brand's own design spec: palette with WCAG corrections,
  layout colour strategy, component rules, shadcn CSS variables, Tailwind config,
  three-font typography system, 4px spacing grid, enforcement rules. **This file is
  the ground truth for every token in this system.**
- `uploads/kangaruRide.png`, `kangaruRide2.png`, `kangaruRide3.png`, `KangaruRide1.png` — logo lockups.
- `uploads/icons.png`, `uploads/Favicons .png`, `uploads/Favicon.png` — mark and app-icon variants.
- Stated inspiration for the web/booking experience: <https://www.uber.com/ug/en/> and
  <https://m.uber.com/go/home>. Used as a *pattern* reference only (inline booking
  panel, vehicle-class picker, live tracking). No Uber visual asset, wording or
  distinctive UI is reproduced.

---

## 2. Content fundamentals

**Voice: the operator's colleague, not the vendor's brochure.** The audience is
dispatchers, finance staff, fleet owners, auditors and bank procurement. They are
accountable for money and vehicles, so copy states facts and consequences.

- **Person.** Address the user as *you* in product UI ("Your driver has accepted").
  Marketing copy uses *we* sparingly and only for commitments ("We will set up a
  tenant and run a parallel month"). Never "I".
- **Casing.** Sentence case everywhere — buttons, labels, table headers (headers are
  additionally uppercased by style, not by content), dialog titles. Title Case only
  in proper nouns and the tagline "For Safety and Reliability".
- **Tone.** Plain, specific, unhedged. Numbers over adjectives: "Position freshness
  under 15 seconds", not "blazing-fast tracking".
- **Buttons are verbs with objects**: "Assign", "Confirm assignment", "Issue credit
  note", "Generate invoices", "Submit and complete". Never "OK", "Submit", "Click here".
- **Destructive copy names the consequence, in the description, not the button**:
  *"A cancellation charge applies per the tenant's rate card. This is recorded in the
  audit log."*
- **Status copy is short and factual**: "In progress", "Waiting", "Variance flagged",
  "Disputed", "Closed". Never cheerful ("All good!") and never bare colour.
- **Errors say what happened and what to do next**: "GPS recorded 38.4 km; odometer
  recorded 42.6 km. Review within 2 business days."
- **Empty states distinguish** "nothing yet" (offer the creating action) from
  "nothing matches" (offer to clear filters).
- **Domain vocabulary is fixed** — use exactly these words: trip (not journey/ride in
  the platform), booking (the request), dispatch/assign (not allocate), odometer (not
  mileage in UI labels), rate card, cost centre, tenant, variance, credit note,
  upcountry, geofence, depot, branch. "Ride" belongs to the consumer-facing website.
- **Money and units.** Amounts are integer UGX, thousands-separated, currency named:
  "UGX 153,520". Distance one decimal + km: "38.4 km". Duration "1h 18m". Timestamps
  ISO-ish and mono: `2026-07-21 08:14:22`.
- **Identifiers are never prettified**: `TRP-2026-04812`, `INV-2026-0417`, `UBK 421J`,
  `CC-1042`.
- **No emoji. Anywhere.** Not in UI, not in marketing, not in reports. Icons carry
  that load.
- **No exclamation marks** in product UI. One is acceptable in marketing only if it
  is quoting a person, which it currently never does.
- Marketing headline register: a claim an auditor would accept. "Corporate transport,
  fully accounted for" · "Every trip recorded. Every invoice reproducible."

---

## 3. Visual foundations

### Colour

Two brand colours and nothing else at the top level: **green `#01903D`** (identity,
action, active state) and **navy `#001028`** (chrome, hero, authority). Everything
else is a neutral or a status hue. The palette in `tokens/colors.css` is DESIGN.md's
accessibility-corrected set — `#019442` was dropped as an imperceptible duplicate,
`#979DA9` is demoted to navy-only/placeholder use (2.7:1 on white), and `#5B6472`
carries secondary text on light.

**Layout colour strategy: dark chrome, light content.** Sidebar and topbar are navy;
content, tables, invoices and reports are always on white. Finance staff read those
for hours. Dense data never goes on navy. Full dark mode is a later, optional theme.

Green is used at three strengths and they are not interchangeable: `--kr-green` for
fills, `--kr-green-hover` (#016B2E) for hover *and* for any green fill under
regular-weight small text, `--kr-green-dark` (#015E35) for green text and icons on
light. Green tint `#E6F4EC` is the only accent background — selected rows, success,
active nav rows, accent cards.

Status colour always ships as a foreground/tint pair and always with a label and icon.
Colour alone never carries meaning.

### Type

Three fonts, three jobs (DESIGN.md §6):

- **Sora** (700/600) — display only: page titles, section headers, KPI numbers, hero
  headlines. Minimum 20px; below that it loses character and Inter takes over. Never
  in body copy, tables or buttons.
- **Inter** (400/500/600) — everything else: body, tables, forms, buttons, labels, nav.
  Numeric views use `font-variant-numeric: tabular-nums` so columns align.
- **JetBrains Mono** (400/500) — machine-readable values only: plates, trip IDs,
  invoice numbers, odometer readings, timestamps, reference codes. Auditors scan these.

Scale is fixed: 12/14/16/18/20/24/30/36. Body is 14px in dense views, 16px elsewhere.
Tracking is tight (-0.02em) on display sizes, normal on body, +0.06em on uppercase
overlines.

### Spacing, layout, radii

4px grid, no exceptions. Dense table cells 8px vertical / 12px horizontal; cards 24px
(16px compact); form rows 16px; page gutter 32px. Content caps at 1440px. Sidebar is
248px expanded, 64px collapsed; topbar 64px. Both are fixed; only the content column
scrolls.

Radii: 4px chips and checkboxes, 8px buttons/inputs (the shadcn `--radius` of 0.5rem),
12px cards, 16px modals, pill for badges and switches. Nothing is fully square except
table cells and full-bleed sections.

### Surfaces, borders, elevation

**Cards are bordered, not floating**: white surface, 1px `#D6DAE1`, 12px radius,
`--shadow-xs`. Structure comes from borders and the sunken `#F7F8FA` / `#F2F4F7`
greys; shadow is reserved for things that genuinely float — popovers (`--shadow-md`),
drawers (`--shadow-lg`), modals (`--shadow-modal`). All shadows are navy-tinted
`rgba(0,16,40,…)`, never neutral black. No inner shadows anywhere. No gradients in
product UI; the only gradient in the system is the faint grid overlay standing in for
map tiles.

### Backgrounds and imagery

No brand photography, illustration or pattern library was supplied. Full-bleed
sections therefore use solid navy, and the design system does not invent imagery.
When real photography arrives it should be documentary and unfiltered — vehicles,
drivers, depots, Ugandan roads — cool-neutral rather than warm-graded, no heavy
grain, no duotone. Place the lockup on a solid navy or white plate over an image,
never directly on the photograph, and never behind a gradient scrim as a substitute.

### Motion

Functional and short. 120ms for hover/focus/checkbox, 180ms for switches, tabs,
dialogs and drawers, 260ms for sidebar collapse, 600ms for map fit-to-route. One
easing curve does almost everything: `cubic-bezier(.2,0,.38,1)`. **No bounce, no
overshoot, no spring, no scale-on-press, no entrance animation on page load.** Fades
and colour transitions only; motion respects `prefers-reduced-motion`.

### Interaction states

- **Hover**: primary buttons darken to `#016B2E`; secondary fills with green tint;
  ghost picks up `#F2F4F7` (or navy-soft on chrome); table rows tint to `#F7F8FA`.
- **Press**: colour only — primary goes to `#015E35`. Never a transform or scale.
- **Focus**: 2px green ring at 2px offset, visible on light *and* navy. Focus
  outlines are never removed. Inputs additionally get a green border plus a 3px
  translucent green glow.
- **Disabled**: 50% opacity, `not-allowed` cursor, no tooltip explaining nothing.
- **Selected**: green tint background plus a 3px green left indicator (nav, queue rows).

### Transparency and blur

Almost never. Two sanctioned uses: the modal scrim (`rgba(0,16,40,.55)`) and the
input focus glow. `--blur-chrome` exists for a future sticky map overlay and is
currently unused. No frosted panels, no translucent cards over content — operators
need to read what is under them.

---

## 4. Iconography

**Lucide, loaded from CDN — a documented substitution.** No icon font, sprite or SVG
set was supplied with the brief. The production stack is shadcn/ui, whose icon
dependency is `lucide-react`, so Lucide is the closest correct match rather than a
free choice. Every icon in this system goes through the `Icon` component, which reads
`window.lucide.icons` and inherits `currentColor`.

```html
<script src="https://unpkg.com/lucide@0.475.0/dist/umd/lucide.js"></script>
```

Rules:

- 2px stroke, 24px grid, `currentColor`, round caps and joins — Lucide defaults, unmodified.
- Sizes: 12px inside badges, 14–16px in dense tables and small buttons, 18px in nav
  and standard buttons, 20–24px standalone.
- Outline only. Never filled, never two-tone, never mixed with another icon family.
- Icons never appear alone as the only label on a control without an `aria-label`
  (`IconButton` enforces this).
- **No emoji, no unicode symbols as icons** (no ✓ ✗ → in place of glyphs).
- Domain glyph vocabulary, used consistently: `route` trips · `navigation` en route ·
  `map`/`map-pin` tracking and locations · `truck` vehicles · `users` drivers ·
  `gauge` odometer · `camera` capture photo · `receipt` invoices · `table-2` rate
  cards · `file-text` reports · `building-2` tenant/company · `shield-check` audit ·
  `triangle-alert` variance/warning · `wifi-off` offline · `lock` immutable.

If the brand later ships a real icon set, replace the `Icon` implementation and this
section — nothing else should need to change.

### Logo assets

Supplied artwork only; the mark is never redrawn, recoloured or reconstructed.

| File | Use |
|---|---|
| `assets/logo-horizontal.png` | Primary lockup on light (transparent background) |
| `assets/logo-horizontal-light.png` | Same lockup, original white background |
| `assets/logo-horizontal-navy.png` | White/green lockup for navy chrome and heroes |
| `assets/logo-stacked-light.png` | Stacked lockup — login, print, documents |
| `assets/logo-horizontal-mono.png` | Single-colour black lockup — faxable PDFs, stamps |
| `assets/logo-mark.png` | Outlined circle mark, transparent |
| `assets/logo-mark-solid.png` | Solid green circle mark — app icon, avatar, collapsed rail |
| `assets/favicon.png` | Square mark source |
| `assets/app-icon-variants.png`, `assets/logo-mark-variants.png` | Supplied reference sheets (labelled; not for direct use) |

Minimum 24px tall for lockups, 20px for the mark. Clear space = mark height ÷ 4.
The tagline "For Safety and Reliability" is part of the artwork — never re-typeset it.

---

## 5. Index

### Root

| File | What it is |
|---|---|
| `styles.css` | The single entry point consumers link. `@import` lines only. |
| `readme.md` | This guide. |
| `SKILL.md` | Agent-skill front matter for use in Claude Code. |
| `thumbnail.html` | Homepage tile for this design system. |
| `tokens/` | `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `elevation.css`, `motion.css`, `base.css` |
| `guidelines/` | 17 foundation specimen cards (colour, type, spacing, radii, elevation, states, motion, logo, iconography) |
| `assets/` | Logo lockups, marks, favicon |

### Components

Grouped by concern. Each has `<Name>.jsx`, `<Name>.d.ts` and `<Name>.prompt.md`, plus
one `@dsCard` HTML per directory.

- **components/brand/** — `Logo`
- **components/core/** — `Button`, `IconButton`, `Icon`, `Card`, `Badge`, `StatusBadge`, `Identifier`, `Tooltip`
- **components/forms/** — `FormField`, `Input`, `Select`, `Checkbox`, `RadioGroup`, `Switch`
- **components/data/** — `DataTable`, `KPIStat`, `Pagination`, `TripTimeline`
- **components/navigation/** — `SidebarNav`, `Topbar`, `Breadcrumbs`, `Tabs`
- **components/feedback/** — `Alert`, `Dialog`, `EmptyState`

`StatusBadge` also exports `TRIP_STATES`, the canonical lifecycle state → tone/label/icon map.

#### Intentional additions

DESIGN.md specifies rules (buttons, status badges, text, focus) rather than a component
inventory, and no component library was supplied. The set above is the standard
primitive set sized to the platform's real screens. Four entries go beyond a generic
kit and are justified by the brief:

- **`Icon`** — a wrapper for the substituted Lucide set, so the substitution lives in one file.
- **`Identifier`** — enforces the JetBrains Mono rule for plates, trip IDs and odometer readings (DESIGN.md §6).
- **`StatusBadge`** — encodes the trip lifecycle from PROJECT.md so no screen invents a status colour.
- **`TripTimeline`** — renders the append-only `trip_events` record, which every trip screen and billing dispute depends on.

### UI kits

| Kit | Entry | Screens |
|---|---|---|
| Enterprise platform | `ui_kits/platform/index.html` | Login, dashboard, dispatch board, trip record, invoices |
| Marketing & booking website | `ui_kits/website/index.html` | Home + booking panel, 3-step booking flow |
| Driver web flow | `ui_kits/driver-web/index.html` | Full trip lifecycle at 390px, incl. odometer capture and offline state |

Each kit has its own `README.md` listing screens and deliberate omissions.

---

## 6. Known gaps

- **Font binaries are missing.** Sora, Inter and JetBrains Mono are correct per
  DESIGN.md but are loaded from Google Fonts in `tokens/fonts.css`; §6 requires
  self-hosted woff2. The self-hosted `@font-face` block is written and commented out —
  drop the files into `assets/fonts/` and switch it on.
- **Icon set is substituted** (Lucide, see §4).
- **No photography, illustration or map assets** were supplied; map areas are labelled
  stand-ins and no imagery is invented.
- No slide template was supplied, so no sample slides exist.
- No codebase or Figma file was supplied, so components are authored from DESIGN.md
  rather than recreated from source; exact production paddings may differ.
