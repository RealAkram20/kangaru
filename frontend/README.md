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

## Tests

```bash
npm run test           # once, as CI runs it
npm run test:watch     # while working
npm run test:coverage  # report only — nothing gates on it yet
```

Vitest + Testing Library, configured inside `vite.config.ts` rather than a
separate `vitest.config.ts` so tests build through exactly the same
pipeline as the app. Two configs is two things to keep in step, and the
failure mode is a test that passes against a build the app never gets.

### What is covered

AGENTS.md asks for "component tests for shared components and critical
flows (booking form, dispatch board)". Both named flows are covered, plus
the credit note dialog:

| File | Why it is here |
|---|---|
| `pages/BookingsPage.test.tsx` | The booking form. Named by AGENTS.md. |
| `pages/DispatchPage.test.tsx` | The dispatch board. Named by AGENTS.md. Its point is what the screen does with a 409 when it loses a race for a vehicle — that is the whole reason the server-side lock is worth having. |
| `pages/billing/CreditNoteDialog.test.tsx` | The only path that changes what a client owes. Highest consequence screen in the app. |
| `pages/NotificationsPage.test.tsx` | The inbox. |
| `components/notifications/NotificationBell.test.tsx` | The badge and panel — the one shared component with tests so far. |

The rest of `src/components/` has **no tests yet**. That is the other half
of the AGENTS.md sentence and the obvious next pass.

### Conventions

- **Globals are off.** `describe`/`it`/`expect` are imported in every file,
  so ESLint and `tsc --noEmit` stay honest without a `types` entry telling
  them about names that only exist under the runner. The cost is that
  Testing Library's auto-cleanup does not fire, so `src/test/setup.ts`
  calls `cleanup()` itself — without it, the second test in a file finds
  the first one's DOM and `getByRole` throws "found multiple elements",
  which reads as a component bug.
- **`src/test/harness.tsx`** supplies `renderAs` (renders with an
  authenticated user without mounting `AuthProvider`, which would hydrate
  itself from `/auth/me` and put an unrelated request in front of every
  assertion), plus `apiOk`/`apiFailure` for the backend's envelopes.
- **`renderAs` wraps everything in `<StrictMode>`**, because `main.tsx`
  does. Testing Library does not by default, and the gap is not
  theoretical — see below. One consequence to know: mount effects run
  twice, so a test asserting an exact request count will be off. Assert
  that a count *grew* across an action instead; that is what those tests
  actually mean.
- **`apiFailure` builds a real `AxiosError`**, not a plain object. `apiError()`
  gates on `axios.isAxiosError()`, so a hand-rolled `{ response: { data } }`
  falls through to the `NETWORK_ERROR` branch — and the test would then
  assert the fallback message while believing it had asserted the server's.
- **Assert what a user sees**, via roles and labels. A test reaching into
  component state would keep passing through a rewrite that broke the
  screen.
- `src/test/setup.ts` also stubs `HTMLDialogElement.showModal`/`close`,
  `ResizeObserver` and `scrollIntoView`, none of which jsdom implements.
  `Dialog` uses a native `<dialog>`, so without the first one every dialog
  test is a TypeError rather than a failed assertion.

### A guard verified by removing it

`CreditNoteDialog` mints its idempotency key with
`useMemo(() => newIdempotencyKey(), [])` — once per dialog, reused on every
retry. Changing it to mint per render turns "reuses the same idempotency
key when a failed attempt is retried" red with two different UUIDs. Without
that guard, a retry after a dropped response becomes a second credit
against the invoice.

### A bug the tests could not see until they rendered like the app

`useNotifications` shipped with a `busy` ref guarding its fetch against
overlap. All tests passed; the browser sat on "Loading…" forever.

StrictMode double-invokes effects in development. The first run took the
flag and started fetching, cleanup marked that closure cancelled, the
second run found the flag held and did nothing, and the first fetch
resolved into a cancelled closure and was thrown away. Nothing ever set
state.

The fix was to drop the guard from the effect — `cancelled` alone is
enough, and two overlapping GETs on mount is a cost worth paying. The
lasting fix is `renderAs` rendering in StrictMode, verified by reinstating
the guard: all 14 notification tests go red.

### An accessibility finding these tests surfaced

`FormField` renders its required marker *inside* the `<label>`, so a
required field's accessible name is `"Passenger*"` and a screen reader
announces "Passenger star". AGENTS.md requires "proper labels, screen
reader compatibility".

The tests match today's behaviour (`getByLabelText(/^passenger\*/i)`)
rather than papering over it. The fix is to mark the asterisk
`aria-hidden="true"` and convey requiredness with `aria-required` on the
control — which means `FormField` either cloning its child or every caller
passing `required` to the input too. That is an accessibility pass, not a
side effect of adding tests, so it is written down here instead.
