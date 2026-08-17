# UI/UX audit plan

The plan the audit follows. Written before the audit so the findings cannot be
shaped to fit whatever was easy to change.

**Scope, decided by the owner on 2026-08-17:** the driver app (`mobile/`, 30
screens) end to end first; the web app (`frontend/`, 22 pages) after it, by the
same passes. **A findings report lands before any screen is touched.** An
orphan surface is reported with the endpoint it would need — never hidden or
deleted on my judgement.

Authorities, in order, unchanged by this document: `docs/screen-rules.md`,
`AGENTS.md`, `DESIGN.md`, `PRODUCT.md`, the ADR for the feature. This plan adds
measurable thresholds where those documents state a principle; where the two
disagree, they win and this file is wrong.

---

## The three complaints, restated as testable claims

The owner's brief, turned into things that are either true or false of a screen.
Everything below exists to decide these.

1. **Too much text.** A screen explains itself in prose where structure,
   a label, or nothing at all would do.
2. **Features are spread, not placed.** A driver has to learn where something
   is instead of finding it where they expected it. Symptoms: the same job on
   two screens, three menu layers, one feature split across three destinations.
3. **Surfaces with no brain behind them.** A control, a number, or a whole
   screen with no endpoint under it. The backend is the product; a screen that
   is not wired to one is decoration.

A fourth, which the owner named as the outcome rather than the defect: **it
reads as AI slop.** That is what the first three produce together — verbose,
evenly-weighted, everything present and nothing prioritised.

---

## What the census already shows

Gathered before writing this plan, so the phases below are aimed rather than
exploratory. These are inputs to the audit, not findings — each is confirmed or
dropped in Phase 2.

| Observation | Numbers |
|---|---|
| Driver app navigation depth | 4 tabs → 13 drawer rows → `SettingsScreen` holds 4 further nav rows. Three menu layers to reach `TimeOff`. |
| Duplicate surface | `TodayScreen` and `HomeScreen` both render `DutyBar`, offers and the trip list. `Today` has one entry point and no drawer row. |
| One feature, many places | Money and standing: `Earnings`, `Wallet`, `Transactions`, `Promotions`, `Performance` — 5 destinations across 2 tabs and the drawer. |
| Prose volume, worst screens | `SafetyScreen` 119 words · `TripDetailScreen` 91 · `TripsHistoryScreen` 73 · `TimeOffScreen` 68 · `DocumentsScreen` 53 |
| Backend wiring, driver app | Only `SignIn`, `SignUp`, `ForgotPassword` have no data hook, and those are correctly formless. **Whole-screen orphans are a web-app risk; the driver app's risk is at control level.** |
| Known debt from the worklog | `mobile/` has **no CI job at all** — jest, tsc, eslint, Prettier are local-only. Three shared mobile files already fail `prettier --check` at `HEAD`. Strings are literals throughout; no i18n extraction. |

---

## Rules of engagement

The tree is shared and hostile: 125 files were already dirty at the start of
this session and another agent was running `jest` in it.

1. **`git status` before every phase**, not once at the start.
2. **A worklog entry before the first edit**, per `docs/agent-worklog.md` — and
   the audit phases below produce documents only, so the entry that claims
   *code* is written at Phase 5, listing real files.
3. **A file another agent owns is reported, not edited.** A screen with an
   owner in the worklog gets a finding addressed to that owner.
4. **A file found mid-mutation is left alone** — that is someone proving a test
   bites (worklog rule 6).
5. **No reformatting of other agents' files.** Prettier drift at `HEAD` is a
   finding, not a licence to touch 60 files.
6. **Nothing is deleted in the audit phases.** Phases 1–4 add documents and
   change no behaviour.

---

## Phase 1 — Census

One machine-generated table, `docs/ux-audit/census.md`, one row per driver
screen. No judgement in this phase; judgement is Phase 2 and must be traceable
to a row here.

Columns: screen · entry points (every `navigate` that reaches it, plus drawer
and tab rows) · exit points · data hooks → endpoints · numbers rendered and
their source · prose word count · governing ADR · worklog owner.

**Entry points are computed, not eyeballed** — from `RootNavigator`,
`navigation/drawer.ts`, and every `navigate(` call site. A screen with zero
computed entry points is a candidate orphan; a screen reachable only through a
dynamic `to.screen` is recorded as such rather than counted as unreachable.

**Exit criterion:** every one of the 30 screens has a complete row, and each
route in `RootNavigator` appears in at least one row's entry column or is listed
as unreachable.

---

## Phase 2 — Four lenses

Each screen goes through all four. A lens produces findings; a finding names the
screen, the defect, **the rule or ADR it breaks**, the proposed fix, and its
cost. A finding that cannot name a rule is an opinion and is dropped.

### Lens A — Reachability and duplication

- Which screens are unreachable, or reachable by exactly one path that nothing
  points at.
- Which two screens answer the same question. `TodayScreen` / `HomeScreen` is
  the open case.
- **Menu depth.** Every destination gets its tap count from a cold home screen.
  Anything a driver touches during a shift and cannot reach in **one tap** is a
  finding. Anything at **three or more** is a finding regardless of frequency.
- **Repeated menus.** The drawer already absorbed `ProfileScreen`'s eight rows
  on the owner's "we don't need to repeat the menus" instruction.
  `SettingsScreen`'s four navigation rows are the same pattern surviving one
  layer down, and are audited against that same instruction.

### Lens B — Backend truth

The lens the owner cares most about: *the backend is the brain*.

- **Every control → an endpoint.** A button, toggle, or field that mutates
  nothing, or writes only to device state where the office should see it, is an
  orphan control. Reported with the endpoint it would need.
- **Every number → a source.** `screen-rules.md` §1: measured or an em dash.
  Any figure without a payload field behind it is a defect, not a placeholder.
- **Every screen → a policy.** Cross-checked against `docs/api/openapi.yaml`, so
  a screen calling an endpoint the contract does not document is caught here
  rather than by CI drift.
- Withheld data (`screen-rules.md` §2) re-checked per screen against its ADR.

**Output is a separate list**, `docs/ux-audit/orphans.md`: each orphan, what it
promises the driver, the endpoint and policy it would need, and the three
options — build, hide, delete — with a recommendation. **No orphan is acted on
in this audit.**

### Lens C — Copy

The measurable half of "too much text".

**The budget.** Non-data prose — every user-facing string that is not a label,
a value, a control, an error, or an accessibility name:

- **≤ 40 words per screen.**
- **≤ 12 words per card or section.**
- **One explanatory sentence per screen.** If a second is needed, the screen is
  explaining a design problem instead of fixing it.

Five screens are over budget today; `SafetyScreen` is over by 3×.

**The rules that generate the cuts.**

- A sentence that restates what the control already says is deleted.
- An instruction that a better default would remove is a design finding, not a
  copy finding — it goes to Lens A.
- A paragraph carrying three facts becomes three labelled rows. Structure beats
  prose for anything read from a cradle in sunlight.
- **Refusals, safety wording, and money explanations are exempt from the cut but
  not from the rewrite.** `screen-rules.md` §1 requires a short line saying why
  a value is missing, ADR-0017 puts the duty refusal wording on the server, and
  a driver at a checkpoint reads the compliance sentence. These get shorter and
  plainer; they do not get removed.
- **No string is deleted that the backend owns.** Server-authored sentences are
  the office's, and shortening them is a backend change with an ADR.
- Every rewritten string stays i18n-safe: no concatenation, no assumed word
  order (`PRODUCT.md`).

### Lens D — Craft

Run per screen, with the tools the platform mandates rather than by eye:

- **`impeccable` in `audit` mode**, and **`hallmark` in `audit` mode** — the
  anti-slop pass, which is the owner's fourth complaint by name.
- **`emil-design-eng`** for component polish; **`review-animations`** for motion
  already shipped.
- Mechanical checks, which are pass/fail: Lucide-only and no emoji (DESIGN.md
  §7) · tokens not raw hex (§8) · WCAG AA measured with a tool, never eyeballed
  · 52pt touch targets · status never by colour alone · motion has a reason and
  never sits on a high-frequency surface.

---

## Phase 3 — One information architecture

The findings from Lens A are a list of complaints; this phase turns them into a
single proposal, `docs/ux-audit/information-architecture.md`.

The doctrine it is written to: **a feature lives where the driver already looks
for it, and lives there once.** For each feature — the day's work, money,
standing, papers, help, account — name the one place it belongs and the
frequency that justifies it. A shift-frequency feature earns a tab; a
weekly one earns a drawer row; a rare one earns a row inside its owner screen.

It must answer, explicitly:

- What the four tabs are, and why each earns its slot against the next
  candidate.
- Whether the drawer and the tab bar can name the same destination without
  becoming the two drifting lists the owner already rejected.
- Whether `Settings` remains a navigation layer or becomes a leaf.
- What happens to `Today`.

Constraint: **`docs/agent-worklog.md`'s status → screen table is binding.** One
`TripStatus` belongs to exactly one screen. Any proposal that merges live-leg
screens changes that table and must say so in the same breath.

---

## Phase 4 — The findings report — **approval gate**

`docs/ux-audit/findings.md`. Ranked by cost to the driver, not by ease of fix.
Each finding: screen · defect · rule broken · proposed fix · effort · blast
radius (files, and whose). Orphans and the IA proposal ride alongside it.

**Nothing is implemented until the owner approves this document.** Where a
finding is a real fork — cheaper fix versus better fix — both are presented with
a recommendation rather than resolved silently.

---

## Phase 5 — Fixes, screen by screen

Only after approval, and only what was approved.

1. Worklog entry first, listing owned and shared files with the exact edit.
2. Highest-cost finding first; one screen per commit.
3. **Shared modules are extended, never forked** — `ui/components.tsx`,
   `ui/facts.tsx`, `trips/contact.ts`, `trips/places.ts`. If a copy cut leaves
   the same shape on three screens, it becomes a component.
4. `impeccable polish` before each screen is called done.
5. Definition of Done per screen (`AGENTS.md`): contract, tests, module README,
   authorization.

---

## Phase 6 — Verification

`screen-rules.md` §8, and the two items this repo keeps skipping.

- **Run it.** Every changed screen rendered on the emulator (AVD `kadson_dev`,
  Metro on 8082, `adb reverse`), with screenshots. Green formatter tests do not
  prove a screen mounts.
- **Prove each guard by mutation.** Introduce the bug the test claims to catch,
  watch it fail, **restore it**. Three surviving mutations on this branch have
  already turned out to be lying tests — every one an existence assertion where
  a count was needed. Assert counts.
- Close the worklog entry: what was built, what was verified on a device, what
  was deliberately not built.

---

## What this audit will not do

Stated now so a gap is visible rather than discovered.

- **It will not add i18n extraction.** Strings are literals across the app; the
  audit keeps rewrites i18n-safe and records extraction as a separate project.
- **It will not build backends for orphans.** Reported only, per the owner.
- **It will not add a dependency, a paid service, or an icon set.** All three
  are owner decisions (`PRODUCT.md`, DESIGN.md §7).
- **It will not fix `mobile/`'s missing CI job**, though that is why this class
  of drift accumulates. It is recorded as a finding with the rest.
- **It will not touch the web app until the driver app is done and approved.**
