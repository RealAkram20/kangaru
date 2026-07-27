# KangaruRide — Frontend

Vite + React + TypeScript + Tailwind CSS SPA for the enterprise platform
(`ui_kits/platform` surface in the design system). See the root
[README.md](../README.md) for repository layout and how to run both apps
together.

## Design system integration

- `src/styles/tokens/*.css` — copied verbatim from
  `../KangaruRide Design System/tokens/`. These are framework-agnostic CSS
  custom properties; `src/index.css` imports them ahead of the Tailwind
  directives.
- `tailwind.config.js` maps `theme.extend.colors`/`fontFamily` onto the
  **real** semantic tokens (`--kr-*`, `--surface-*`, `--text-*`,
  `--action-*` from `tokens/colors.css`) — not the shadcn HSL-triplet block
  in `DESIGN.md` §4, which the actual design system components don't use
  (confirmed by reading the component source: plain React with inline
  `style` props reading CSS vars, zero Radix/shadcn).
- 9 components ported as real `.tsx` ES modules under `src/components/`:
  `Icon`, `Button`, `Card`, `IconButton`, `Input`, `FormField`, `Logo`,
  `Topbar`, `SidebarNav`. `IconButton` wasn't in the original minimum list
  but is a hard dependency of `Topbar`. The remaining ~20 components in
  `KangaruRide Design System/components/` are **not** ported yet.
- `Icon.tsx`'s only real change from the source: the original reads
  `window.lucide.icons` (a CDN UMD global, for the design system's
  zero-build browser preview harness) — this uses the `lucide-react` npm
  package's `icons` dictionary export instead, so the app works fully
  offline/bundled.
- The `ui_kits/platform/*.jsx` screens are **not** copy-pasteable — they
  have zero `import` statements and reference components as bare globals
  (`Object.assign(window, window.KangaruRideDesignSystem_69b541)`) for the
  same CDN-preview reason. `LoginPage.tsx` and `DashboardPage.tsx` are
  hand-ported from `LoginScreen.jsx`/`DashboardScreen.jsx` with real
  imports and simplified scope (see below).

## Known gaps / follow-ups

- **Fonts are still Google-Fonts-loaded**, not self-hosted. No `.woff2`
  binaries were supplied with the brief; `tokens/fonts.css` has the
  self-hosted `@font-face` block written and commented out — drop files
  into an `assets/fonts/` equivalent and switch it on.
- **`LoginPage` has no MFA step.** The original `LoginScreen.jsx` includes
  a Badge/Alert/Checkbox-driven MFA flow; it's dropped here because the
  backend has no MFA endpoint yet (MFA is Phase 1-scoped to Super Admin/
  Finance only, per `PROJECT.md`). Revisit together when MFA ships.
- **`DashboardPage` is an empty shell** — Topbar + SidebarNav + a bare
  content area. No KPI cards, tables, or real dashboard widgets yet.
- **Auth token is stored in `localStorage`.** Standard pairing for
  Sanctum's non-cookie bearer-token mode, but carries a known
  XSS-exfiltration risk. Acceptable for this scaffold; revisit (httpOnly
  cookie + Sanctum SPA stateful mode) before real bank PII flows through
  the app.
- `npm audit` currently flags a high-severity advisory in `react-router`
  (GHSA-qwww-vcr4-c8h2) affecting its RSC (React Server Components) mode.
  This app is a plain client-rendered SPA and does not use RSC, so the
  advisory doesn't apply to how `react-router-dom` is used here — noted
  rather than force-downgraded, since the suggested fix is an older,
  pre-vulnerability release, not a forward patch.
- Tailwind is v3 (matches `DESIGN.md` §5's literal config shape) — a v4
  migration is a reasonable, non-urgent future step.
- The Vite scaffold's default linter (`oxlint`) was replaced with a real
  ESLint + `typescript-eslint` flat config (`eslint.config.js`), since
  AGENTS.md's CI Gates explicitly require ESLint + Prettier.

## Local development

```bash
npm install
cp .env.example .env
npm run dev       # http://localhost:5173, expects the backend on :8000
```

Static gates: `npm run lint` (ESLint), `npx tsc --noEmit`, `npm run build`.
