---
name: audit
description: The single entry point for any agent joining the KangaruRide go-live or driver-app audit effort. Reads the worklog, claims an unclaimed work package, loads the skills and documents that package needs, and carries the shared-tree rules that keep parallel agents from overwriting each other. Use with no argument to be assigned the next package, or with a package id (A0, W1-a…W1-f, W2-a, B0…B3, or K0…K9 for the platform plan) to take a specific one.
---

# Join the effort

One command, whatever the work. **Do the four steps below in order. Do not
skip step 1 — it is the one that is cheapest to skip and most expensive to have
skipped.**

---

## 1 · Log in to the worklog

**Read `docs/agent-worklog.md` now, before anything else.** Several agents build
in this one shared tree at the same time; this file is how they stay out of each
other's way, and it is binding.

Note in particular:

- The open entries — who is building what, and which files are claimed.
- The **trip status → screen ownership table**. A `TripStatus` belongs to
  exactly one screen. Two screens claiming one status is the bug this file
  exists to prevent.
- Any entry marked *in progress*. Those files are not yours.

Then **run `git status`**, however recently anyone looked. The status someone
took an hour ago is already stale.

---

## 2 · Take a package

**Read `docs/master-plan.md` in full.** It holds the decisions, the completeness
gate, the sequence and the go/no-go list. It is the single source of truth and
outranks anything in your prompt.

**If a package id was given** (`A0`, `W1-a`…`W1-f`, `W2-a`, `B0`…`B3`, or `K0`…`K9`), that is
yours. Check the worklog first: if someone already holds it, say so and stop.

**If no id was given**, take the next package that is (a) unclaimed in the
worklog and (b) whose dependencies are met per the master plan's §3 sequence.
Announce which one you took and why, before starting.

**`A0` is solo and blocking.** If `A0` is unfinished, no other package may start
— say so and stop rather than working around it.

**If your package is a `K`, read `docs/platform-plan.md` in full as well.** It
is the front door for that work: the model, the ten packages, the file
ownership matrix that keeps you off other agents' files, and **§2, what "done"
means here** — seven gates, of which gate 6 (it says so when it breaks, proved
by triggering it) is the one most likely to be new to you. `K0` is solo and
blocking for the K packages exactly as `A0` is for everything.

### Claiming, without racing another agent

Two agents starting at the same moment will both read an unclaimed package and
both take it. So:

1. **Write your worklog entry first**, before any other work, with a timestamp.
2. **Re-read the file.** If another entry claims the same package, **the later
   timestamp yields** — withdraw, say so, and take the next one.
3. Only then start.

Your entry lists files you *own* (nobody else edits) and, separately, shared
files you must touch with **the exact edit named**. An entry added after the
work is a collision report, not a plan.

---

## 3 · Load what your package needs

**Always:** `docs/agent-briefs.md` — the block for your package names what you
own, what you must not touch, and your exit criteria.
`docs/track-a-parallel-plan.md` — the long-form brief behind it. **Where the
master plan amends it, the master plan wins.** Then `AGENTS.md` and
`PRODUCT.md`.

**If your package touches any screen, page, form, modal or component** —
`W1-e`'s privacy notice, every Track B package, and `K3`, `K4`, `K6`, `K7` —
**load the `screen` skill now.** It pulls in `quality-control`, `DESIGN.md` and `docs/screen-rules.md`,
and those rules outrank any mockup. For a Track B audit phase, also read
`docs/ux-audit-plan.md` in full; its thresholds are fixed in advance so a
finding cannot be shaped to fit whatever was easy to change.

**If your package touches no UI** — `A0`, `W1-a`…`W1-d`, `W1-f`, `W2-a`, `K0`, `K2`, `K5` — do
not load `screen`. It loads the wrong context and buries the brief.

**The ADR for anything you touch** lives in `docs/adr/`. Find it before you
build, not after. Several rules exist because an ADR already decided something
a mockup or a plan contradicts.

---

## 4 · Work

### The decision loop

Before implementing, name the decisions you are about to make — layout,
component, data shown, interaction, dependency, copy, infrastructure. For each,
ask once: *is there a better version of this, judged against the north star —
efficient, subscription-expense efficient, international-ready, modern and user
friendly?*

- A plainly better version: take it and say so.
- A **real fork** — two versions differing in cost, UX or scope: stop and ask
  the owner with concrete options.
- An obvious conventional answer: decide it, state it, move on.

Asking good questions before building is expected. Asking permission to do the
obvious is not.

**No new paid service, subscription, metered API, dependency or icon set
without the owner.** Coolify is self-hosted and that is the point.

### The rules that keep being broken

- **Never invent a number.** If the platform cannot produce it, render an em
  dash and a short line saying why. A zero is not a substitute for unknown.
- **Never show what an ADR withholds.** Allow-list fields; never spread a whole
  object into a response.
- **Icons are Lucide, never emoji.** Tokens, never raw hex. 52pt touch targets
  in the driver app.
- **Never edit a file another package owns** — report it. A file found
  mid-mutation (a guard returning `true`, an assertion commented out) is another
  agent proving a test bites: leave it and say so.

### The completeness gate

`docs/master-plan.md` §2, and it governs what may ship at all. A feature is
whole only when **backend → the actor can reach it → the office can see and
answer it → the actor finds out what happened**. Missing any part is
half-built. If your work uncovers a half-built loop, that is a finding for
`W1-f` — do not quietly complete it and do not quietly hide it.

---

## Finishing

1. Meet the **exit criteria in your brief**. They are specific, and they are
   your definition of done.
2. **Verify by running, not by assuming.** Green tests over formatters prove
   nothing about a deployed system or a screen that mounts.
3. Where a test claims to catch a bug, **prove it by mutation**: introduce the
   bug, watch it fail, **restore it before you finish**. Three surviving
   mutations on this branch turned out to be lying tests — every one an
   existence assertion where a count was needed. Assert counts.
4. **Close your worklog entry**: mark it done, correct the file lists to what
   you actually touched, and record what you deliberately did not build.

Report plainly what was verified, what was **not**, and what you left out.
A gap someone else can see is a gap they will not rebuild badly.
