---
name: quality-control
description: The quality bar for all UI work on this platform — web app or driver app. Use whenever a screen, page, form, modal, component, or visual change is being designed, built, polished, or reviewed, alongside the /screen skill. Enforces the brand guides, Lucide-only iconography, the impeccable and Emil design skills, and a decision loop that questions every choice against the platform's goals before code is written.
---

# Quality control

This skill is the bar the work must clear, not a checklist to skim. It rides
alongside `/screen` (which owns file claiming and screen rules); load both for
any UI work.

## The north star

Every decision is judged against what this platform is becoming:

- **More efficient** — for the user (fewer clicks, faster scanning, less
  waiting) and for the operator (lean code, no wasted requests or renders).
- **Subscription-expense efficient** — prefer open-source and self-hosted
  over recurring paid services. A new paid subscription, metered API, or
  per-seat dependency is a **user decision**: stop and ask before adding one.
- **International market ready** — Uganda first, but nothing new may deepen
  the Uganda assumption: i18n-safe strings, currency-shaped money
  (`amount` + ISO 4217, minor units), timezone-aware dates, no hardwired
  phone/plate/address formats.
- **Modern and user friendly** — a first-time user understands it; it feels
  current, not templated. `PRODUCT.md` records the product truth behind this.

## Before implementation: the decision loop

Before writing code, name the decisions you are about to make — layout,
component choice, data shown, interaction pattern, dependency, copy. For each
one, run this loop **at least once**:

> "Is there a better version of this decision, judged against the north star?"

- If a plainly better version exists, take it and say so.
- If two versions genuinely differ in cost, UX, or scope — a **real fork** —
  stop and ask the user with concrete options. Do not ask about decisions
  with an obvious conventional answer; decide those and move on.
- If the better version conflicts with a mockup or an instruction, raise it
  (the `/screen` rule: rules outrank mockups) — never resolve it silently.

Asking good questions before building is expected. Asking permission to do
the obvious is not.

## The tools you must use

- **`impeccable`** — invoke it for design work: `shape` before building a new
  surface, `critique`/`audit` when reviewing, `polish` before shipping. Its
  craft floor is the minimum finish for this platform.
- **Emil Kowalski's skills** — `emil-design-eng` for component polish and the
  invisible details; `animate` when building motion; `review-animations` when
  judging it. Motion follows DESIGN.md §7: icons a user sees hundreds of
  times a day never animate.

## Brand guides are binding

Read and obey, in order: `docs/screen-rules.md`, `AGENTS.md`, `DESIGN.md`,
`PRODUCT.md`, and the relevant ADR in `docs/adr/`. Non-negotiables that keep
being tested:

- **Icons: Lucide only. Never emoji.** Web: `lucide-react` (+ vendored
  Animate UI where motion earns it). Driver app: hand-drawn SVG in
  `mobile/src/ui/icons.tsx`, paths transcribed verbatim from Lucide. No
  other icon set, no `@expo/vector-icons`, no emoji as interface
  iconography — not in buttons, labels, empty states, toasts, or docs
  screenshots. If Lucide lacks the glyph, that is a design conversation.
- **Tokens, not hex.** Raw hex in component code fails review (DESIGN.md §8).
- **Typography:** Sora for display only, Inter for UI, JetBrains Mono for
  identifiers. Self-hosted, never hotlinked.
- **WCAG AA:** contrast checked with a tool, keyboard reachable, visible
  focus, status never by color alone.
- **Honest screens:** no number the platform cannot produce, no data an ADR
  withholds.

## Finishing

Quality control is not done at "it compiles". Before reporting done:

1. Run or render the real screen (`/screen` finishing rules apply).
2. Run an `impeccable polish` or `critique` pass on what you built.
3. State plainly what was verified, what was not, and which decisions you
   flagged as forks versus decided yourself — and why.
