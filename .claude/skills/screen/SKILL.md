---
name: screen
description: The rules for designing or building any screen in this platform — web app or driver app, including how parallel agents claim files and avoid colliding in the shared working tree. Use whenever a screen, page, form, modal, or component is being designed, built, or reviewed, whenever work starts from a mockup or a design reference, and whenever more than one agent is working at once. Also use when reviewing a screen someone else built.
---

# Building a screen

**Read `docs/screen-rules.md` now, in full, before designing or writing
anything.** That file is the single source of truth and is kept current; this
skill exists only to make sure it is read.

**Load the `quality-control` skill now as well.** It is the quality bar over
this skill: the decision loop to run before implementing, the Lucide-only /
no-emoji icon rule, the impeccable and Emil design skills, and the north-star
goals (efficient, subscription-expense efficient, international-ready, modern,
user friendly) every decision is judged against.

Then read, in this order:

1. `docs/agent-worklog.md` — **who else is building right now, and which files
   are already claimed.** Several agents work in this one shared tree at the
   same time. See "Before you write a line" below; this step is not optional
   and it is the one that is cheapest to skip and most expensive to have
   skipped.
2. `AGENTS.md` — the platform's engineering standards.
3. `DESIGN.md` — palette, typography, spacing, component rules, and §7 Icons.
4. `PRODUCT.md` — the product truth: users, positioning, and the constraints
   (i18n-ready, cost discipline) new work must not erode.
5. The ADR in `docs/adr/` covering the feature you are touching. Find it
   before you build, not after — several of these rules exist because an ADR
   already decided something a mockup contradicts.

## Before you write a line: claim your work

Agents run in parallel against **one working tree**. Another agent's files
appear mid-session, and the `git status` you took at the start is already
stale.

1. **Run `git status` again, now**, however recently you looked. Then list the
   directory you are about to build in. A module you were about to write may
   already exist.
2. **Read `docs/agent-worklog.md`** and check the trip-status → screen
   ownership table. If the state your screen renders is already claimed, stop
   and raise it — do not build a second screen for one status.
3. **Add your entry to `docs/agent-worklog.md` before writing code**, using the
   template at the bottom of that file. List the files you *own* and,
   separately, the shared files you must touch, with the exact edit named.
4. **Never fork a shared module.** `mobile/src/ui/components.tsx`,
   `mobile/src/ui/facts.tsx`, `mobile/src/trips/contact.ts`,
   `mobile/src/trips/places.ts` and the web component library are the common
   vocabulary. Extend them; do not copy them.
5. **Before editing a file another agent owns, say so and wait.** A minimal
   diff to a shared file is fine and expected. A rewrite of someone's screen
   is not.
6. **If you find a file mid-mutation** — a guard that returns `true`, an
   assertion commented out — that is another agent proving a test bites. Leave
   it alone and say so; do not "fix" it and do not build on it.

An entry added after the work is a collision report, not a plan.

## The one rule that governs the rest

**These rules outrank any mockup.**

If a mockup asks for something the rules forbid — most often a number the
platform cannot produce, such as an ETA or a money figure with no backend —
**stop and raise it with the user before writing code.** Do not silently
resolve the conflict in the mockup's favour, and do not silently drop the
element either. Say what the conflict is, recommend the honest alternative,
and let the user decide.

That single habit is why this skill exists. A mockup is someone's intent, not
a specification, and the two most damaging things a screen can do here —
inventing a figure and exposing withheld data — both arrive looking like
faithful implementation.

## Finishing

Work through the checklist at the bottom of `docs/screen-rules.md` before
reporting the work done. Two items are load-bearing and routinely skipped:

- **Run or render it.** Passing unit tests over formatters do not prove a
  screen mounts.
- **Prove each guard by mutation.** Introduce the bug a test claims to catch
  and watch it fail. A test that cannot fail proves nothing. **Restore every
  mutation before you finish** — another agent is reading these files.

Then close your `docs/agent-worklog.md` entry: mark it done, correct the file
lists to what you actually touched, and record what you deliberately did not
build. A gap someone else can see is a gap they will not rebuild badly.

Report honestly what was verified, what was not, and anything left out.
