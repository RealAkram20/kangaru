# DESIGN.md

# KangaruRide Design System

Brand palette derived from the KangaruRide logo, corrected for WCAG AA accessibility
and mapped to semantic tokens for React + Tailwind CSS + shadcn/ui.

Rule of thumb: **components never reference raw hex values** — they use semantic
tokens. Raw hex lives only in this file and the Tailwind/CSS variable definitions.

---

# 1. Brand Palette

| Token | HEX | Role |
|---|---|---|
| `brand-green` | `#01903D` | Brand identity, large headings, logos, large/bold accents |
| `brand-green-hover` | `#016B2E` | Hover state for green interactive elements (visibly darker) |
| `brand-green-dark` | `#015E35` | Green text on light backgrounds, active states, icons |
| `brand-green-tint` | `#E6F4EC` | Success backgrounds, selected rows, subtle highlights |
| `brand-navy` | `#001028` | Sidebar, top chrome, marketing hero backgrounds |
| `brand-navy-soft` | `#0A1F3D` | Elevated surfaces on navy (cards inside sidebar) |
| `white` | `#FBFBFB` | Content surfaces, cards, text on navy |
| `gray-text` | `#5B6472` | Secondary text on LIGHT backgrounds (replaces #979DA9 there) |
| `gray-muted` | `#979DA9` | Secondary text on NAVY backgrounds only; placeholder text on light |
| `gray-border` | `#D6DAE1` | Borders, dividers on light surfaces |
| `gray-dark` | `#293348` | Borders/disabled elements on navy surfaces |

## Changes from the extracted palette — and why

1. **`#979DA9` demoted on light surfaces.** It measures ~2.7:1 against white — fails
   WCAG AA (4.5:1) for text. It stays for secondary text on navy (~7:1, passes) and
   for placeholders. New `#5B6472` handles secondary text on white at ~5.9:1.
2. **`#019442` (Secondary Green) removed.** It differs from the primary by an
   imperceptible amount and is useless as a hover state. Hover is now `#016B2E`,
   a clearly visible darkening.
3. **`#01903D` restricted for small text.** White-on-primary-green is ~4.1:1 —
   passes only for large text (18px+/14px bold). Normal-size button labels use the
   button rules in §3. Green text on white always uses `brand-green-dark`.
4. **Added `brand-green-tint`, `brand-navy-soft`, `gray-border`** — every real UI
   needs a success tint, an elevated dark surface, and a light border; defining them
   now prevents seven ad-hoc grays appearing in month two.

---

# 2. Layout Color Strategy

Enterprise pattern: **dark chrome, light content.**

- Sidebar + top bar: `brand-navy` background, `white` primary text, `gray-muted`
  secondary text, `brand-green` active-item indicator.
- Content area: `white` background, cards on white with `gray-border`.
- Data tables, invoices, reports: always on light surfaces — finance staff read
  these for hours; do not put dense data on navy.
- Full dark mode is a later, optional theme — not the Phase 1 default.

---

# 3. Component Rules

## Buttons

| Variant | Background | Text | Hover |
|---|---|---|---|
| Primary | `brand-green` | `#FBFBFB`, **font-semibold, min 14px bold** | `brand-green-hover` |
| Secondary | transparent | `brand-green-dark` | `brand-green-tint` bg |
| Destructive | `#B42318` | `#FBFBFB` | `#912018` |
| Ghost / on navy | transparent | `#FBFBFB` | `brand-navy-soft` bg |

Primary button labels are semibold specifically to satisfy the large-text contrast
threshold on `brand-green`. If a design needs regular-weight small text on a green
button, use `brand-green-hover` (#016B2E) as the background instead — it passes AA
for normal text.

## Text on light surfaces

- Primary text: `#1A2233` (near-navy, softer than pure black)
- Secondary text: `gray-text` `#5B6472`
- Placeholder / disabled: `gray-muted` `#979DA9`
- Links & green accents: `brand-green-dark`, underline on hover

## Text on navy surfaces

- Primary: `#FBFBFB` · Secondary: `gray-muted` · Disabled: `gray-dark`

## Status colors (trip lifecycle & system states)

| State | Color | Tint bg |
|---|---|---|
| Success / Completed | `#015E35` | `#E6F4EC` |
| Warning / Waiting / Flagged variance | `#B54708` | `#FEF0C7` |
| Error / Cancelled / No Show | `#B42318` | `#FEE4E2` |
| Info / En Route / Assigned | `#175CD3` | `#EFF4FF` |
| Neutral / Draft / Closed | `#5B6472` | `#F2F4F7` |

Never communicate status by color alone — always pair with a label or icon
(accessibility requirement from AGENTS.md).

## Focus states

All interactive elements: 2px ring in `brand-green` with 2px offset, visible on
both light and navy surfaces. Never remove focus outlines.

---

# 4. CSS Variables (shadcn/ui compatible)

```css
/* globals.css */
@layer base {
  :root {
    --background: 0 0% 98%;           /* #FBFBFB */
    --foreground: 220 32% 15%;        /* #1A2233 */

    --card: 0 0% 100%;
    --card-foreground: 220 32% 15%;

    --primary: 145 99% 28%;           /* #01903D */
    --primary-hover: 145 96% 21%;     /* #016B2E */
    --primary-foreground: 0 0% 98%;

    --secondary: 150 33% 93%;         /* #E6F4EC */
    --secondary-foreground: 152 96% 19%; /* #015E35 */

    --muted: 220 20% 96%;
    --muted-foreground: 218 11% 40%;  /* #5B6472 */

    --accent: 150 33% 93%;
    --accent-foreground: 152 96% 19%;

    --destructive: 4 74% 40%;         /* #B42318 */
    --destructive-foreground: 0 0% 98%;

    --border: 219 16% 86%;            /* #D6DAE1 */
    --input: 219 16% 86%;
    --ring: 145 99% 28%;

    --radius: 0.5rem;

    /* KangaruRide chrome (sidebar/topbar) */
    --sidebar: 216 100% 8%;           /* #001028 */
    --sidebar-elevated: 217 72% 14%;  /* #0A1F3D */
    --sidebar-foreground: 0 0% 98%;
    --sidebar-muted: 218 10% 63%;     /* #979DA9 */
    --sidebar-border: 222 27% 22%;    /* #293348 */
  }
}
```

# 5. Tailwind Config

```ts
// tailwind.config.ts (extend.colors)
colors: {
  brand: {
    green: "#01903D",
    "green-hover": "#016B2E",
    "green-dark": "#015E35",
    "green-tint": "#E6F4EC",
    navy: "#001028",
    "navy-soft": "#0A1F3D",
  },
  // shadcn semantic tokens map to the CSS variables above:
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  primary: {
    DEFAULT: "hsl(var(--primary))",
    hover: "hsl(var(--primary-hover))",
    foreground: "hsl(var(--primary-foreground))",
  },
  sidebar: {
    DEFAULT: "hsl(var(--sidebar))",
    elevated: "hsl(var(--sidebar-elevated))",
    foreground: "hsl(var(--sidebar-foreground))",
    muted: "hsl(var(--sidebar-muted))",
    border: "hsl(var(--sidebar-border))",
  },
  // ...secondary, muted, accent, destructive, border, input, ring as standard shadcn
}
```

---

# 6. Typography & Spacing

Three-font system: distinctive display, invisible workhorse, scannable data.

| Role | Font | Weights | Used for |
|---|---|---|---|
| Display | **Sora** | Bold 700, SemiBold 600 | Page titles, H1/H2, dashboard section headers, KPI numbers, login/marketing screens, brand moments |
| Body / UI | **Inter** | Regular 400, Medium 500, SemiBold 600 | All body text, tables, forms, buttons, labels, navigation |
| Data identifiers | **JetBrains Mono** | Regular 400, Medium 500 | Vehicle registration plates, trip IDs, invoice numbers, odometer readings, reference codes |

Rules:

- **Sora is never used for body text or table content.** Its wide geometric forms
  cost horizontal space and scanability in dense data views. Display roles only.
- Sora ships as Bold/SemiBold only — if a Sora element needs to feel lighter, it
  should probably be Inter instead.
- Buttons and form labels use Inter Medium/SemiBold, not Sora, so controls stay
  compact and consistent.
- Numeric-heavy views (invoices, reports, statements) use Inter with
  `font-variant-numeric: tabular-nums` so columns align. Identifiers within those
  views (invoice no., plate) render in JetBrains Mono to be instantly
  distinguishable from prose — auditors scan these.
- All three fonts are **self-hosted** (woff2, `font-display: swap`, preload the
  two primary weights). No hotlinking to Google Fonts — faster on upcountry
  connections and works offline-cached.
- Fallback stacks:
  - Display: `Sora, Inter, system-ui, sans-serif`
  - Body: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`
  - Mono: `"JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace`

Tailwind:

```ts
// tailwind.config.ts (extend.fontFamily)
fontFamily: {
  display: ["Sora", "Inter", "system-ui", "sans-serif"],
  sans: ["Inter", "system-ui", "sans-serif"],
  mono: ["JetBrains Mono", "ui-monospace", "monospace"],
}
// Usage: font-display for headings/KPIs, font-sans default, font-mono for IDs
```

Scale: 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36. Body is 14px in dense tables,
16px elsewhere. Sora display sizes start at 20px — below that it loses its
character and Inter takes over.

Spacing on the 4px grid. Dense data tables may use compact 8px cell padding;
forms and cards use 16/24.

---

# 7. Enforcement

- Raw hex values in component code fail review — use tokens.
- Any new color pairing must pass WCAG AA (4.5:1 normal text, 3:1 large text/UI
  components) before merging; check with a contrast tool, don't eyeball it.
- Status badges always include text/icon, never color alone.
- These rules extend the Frontend Standards and Accessibility sections of AGENTS.md
  and are covered by the same Definition of Done.
