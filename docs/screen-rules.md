# Building a screen

Read this before designing or building any screen, in the web app or the
driver app. **These rules outrank any mockup.** If a mockup disagrees with
something here, stop and say so before writing code — do not quietly resolve
it in the mockup's favour.

Authoritative sources, in order: `AGENTS.md`, `DESIGN.md`, then the ADR that
covers the feature (`docs/adr/`). This file is a checklist over those, not a
replacement for them.

---

## 1. Never invent a value

If the platform cannot produce a number, the screen does not show one. Render
an em dash (`—`) and a short line saying why.

- **No ETAs.** ADR-0020 §3 refused to derive minutes from straight-line
  distance, because real roads are longer than the crow's flight and the
  figure would run short in front of a passenger. Distance is measured;
  minutes are not.
- **No money without a real figure.** `HomeScreen` renders earnings and wallet
  as `—` because no backend produces them. A driver who reads a number they
  cannot collect has been lied to about money.
- A zero is not a substitute for unknown. `UGX 0` reads as a free ride.

A mockup showing an invented value is a question for the person who asked, not
a licence to fabricate it.

## 2. Never show what is deliberately withheld

Check the ADR before putting a name, phone number, or address on a screen.
ADR-0024 §7 releases the passenger's contact details only *after* a driver
accepts — and offer payloads also become push notifications, which land on a
lock screen.

**Allow-list fields; never spread a whole object into a response.**
`order_requests.details` carries `sender_phone` and `recipient_phone`; a
resource emitting that column wholesale leaks two numbers and looks harmless
in review, because the field is called `details`.

## 3. Reuse before you create

- Components from `mobile/src/ui/components.tsx` or the web component library.
- Colour, spacing, radius and type from the theme tokens. **No raw hex**, no
  one-off spacing values, no new font sizes.
- No new dependency without asking first.

If something appears twice, it becomes a shared component (AGENTS.md).

## 4. Icons are Lucide — DESIGN.md §7

One vocabulary across both apps. Web uses `lucide-react`, plus Animate UI for
the few that animate. The driver app hand-draws them in
`mobile/src/ui/icons.tsx`, transcribed **verbatim** from `lucide-react` —
never approximated by eye.

Never add another icon set. A new icon must exist in Lucide first.

## 5. Motion

Use the project's easing and duration tokens (`motion` in the mobile theme).

- Under 300ms for UI. Ease-out for entrances, never ease-in.
- Animate `transform` and `opacity` only. Never from `scale(0)`.
- Do not animate anything seen dozens of times a day, or any
  keyboard-initiated action.
- Respect reduced motion: gentler, not absent.
- Every animation needs a reason. "It looks nice" is not one.

## 6. Accessibility is not optional

Real labels on every control. Touch targets at least 52pt in the driver app —
a mis-tap there posts a state transition. **Never carry meaning by colour
alone**; pair it with a label or an icon. Compose one sensible announcement
for a screen reader rather than leaving a grid to linearise into disconnected
numbers.

Remember the conditions: a phone in a cradle, in direct Kampala sun, often
one-handed.

## 7. Ship the whole change

A screen is not done when it renders. Definition of Done (AGENTS.md):

- the API contract updated in `docs/api/openapi.yaml` — CI fails on drift;
- tests;
- the module README;
- authorization and policy covered.

## 8. Verify it, then try to break it

Run or render the thing. Green tests over formatters do not prove a screen
mounts.

Then **prove each guard by mutation**: introduce the bug the test claims to
catch and watch it fail. A test that cannot fail proves nothing. This has
repeatedly caught bad tests in this repo.

## 9. A screen carries no explanation

Reported by the owner, 22 August 2026: agents *"write unwanted descriptions on
the pages which makes the experience very poor."* This is the rule that stops
it.

**A screen is an instrument, not a document.** The person reading it is
mid-task, often standing, often in a hurry. Every sentence that is not helping
them finish costs them time and makes the product feel amateur.

### Words that earn their place

- The **label** of a control, and the **unit** of a number.
- An **error**: what went wrong and what to do about it.
- An **empty state**: what this list will hold, and the one action that starts
  it.
- A **confirmation** before something irreversible, naming what will happen.
- A **disclosure** the law requires — and only where it requires it.

### Words that do not

- **"This page allows you to…"** and every variant. If the screen needs to
  explain what it is, the title and layout have failed and prose will not save
  them.
- **Helper text restating the label.** "Email address — enter the email
  address" is noise twice.
- **The reason a field exists.** The user does not need the rationale to type
  into it.
- **Your reasoning, the ADR, the trade-off, the constraint.** These are real
  and they matter — they belong in the code comment, the ADR, the module README
  and the worklog. **Never in front of the user.**
- **Section blurbs under headings.** A heading plus a paragraph explaining the
  heading is a document, not an interface.
- **Tips nobody asked for**, and anything beginning "Note:".
- **Marketing.** If it explains the product to somebody who is not using it, it
  belongs on the landing page.

### The test

Read the screen aloud as the person using it, mid-task. **Every sentence that
is not helping them finish is noise — delete it.** If you cannot delete a
sentence because the screen stops making sense without it, the screen is what
needs fixing: a clearer title, a better label, a different layout. Prose is
never the fix for an unclear interface; it is the symptom.

One consequence worth stating, because it is where this rule is most often
broken: **an empty state is one line and one button.** Not a paragraph
explaining the feature.

Where genuine background is unavoidable — a legal notice, a policy the user
must understand before consenting — it goes behind a link or a disclosure, not
in the flow of the task.

---

## Before you finish, confirm

- [ ] Every number on screen came from the backend, or renders as `—`.
- [ ] Nothing on screen is withheld by an ADR.
- [ ] No raw hex, no new spacing values, no new dependency.
- [ ] Icons are Lucide.
- [ ] Animations have a reason, and none of them is decoration on a
      high-frequency surface.
- [ ] Contract, tests and README ship with it.
- [ ] I ran it, and I broke each guard to prove the tests bite.
- [ ] **No sentence on this screen explains the screen.** I read it aloud as
      the user, mid-task, and deleted everything that was not helping them
      finish (§9).
- [ ] **It says so when it breaks.** The failure path renders a visible error
      *and* reports to Sentry with allow-listed context — and I proved it by
      triggering it, not by reading the code.
