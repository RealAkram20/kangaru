# Animate UI (vendored)

Animated icons from [animate-ui.com](https://animate-ui.com), pulled in with
the shadcn CLI. **Do not hand-author files in this directory** — see
DESIGN.md § Icons for the rule that governs them.

## Adding an icon

```bash
npx shadcn@latest add https://animate-ui.com/r/icons-<name>.json
```

`<name>` is the Lucide name in kebab-case (`circle-check`, not `CircleCheck`).

**The registry is partial.** Roughly half the Lucide set has an animated
counterpart; at the time of writing `camera`, `phone`, `mail`, `wallet`,
`eye`, `shield-check` and `car` did not. A 404 is the normal answer, not a
mistake — import that icon from `lucide-react` instead. Because Animate UI
draws Lucide's own geometry, the two sit together with no visible seam.

## Two patches to re-apply after any pull

The registry sources assume a laxer TypeScript config than this project's,
so `shadcn add` will re-introduce both. `tsc -b` catches them immediately.

1. **`primitives/animate/slot.tsx`** — replace `keyof HTMLElementTagNameMap`
   with the local `MotionTag` type. `@types/google.maps` augments
   `HTMLElementTagNameMap` with custom elements Motion does not accept, and
   the unfiltered union breaks compilation for everything downstream. The
   reason is written out in the file.
2. **`icons/*.tsx`** — drop the unused `import * as React` (`noUnusedLocals`)
   and mark `Variants` as a type-only import (`verbatimModuleSyntax`).

Both are mechanical. Neither changes behaviour.

## Why lint is relaxed here

`eslint.config.js` switches the React Compiler rules off over this directory.
Animate UI's `icon.tsx` writes state from effects and reads refs during
render — real violations that we are not going to hand-fork a 650-line
library to fix, and which a re-pull would undo anyway. Type checking is *not*
relaxed. If a file here ever becomes something we maintain ourselves, move it
out of this directory so the normal rules apply again.

## Animating with restraint

An icon that animates every time it is seen stops reading as feedback and
starts reading as noise. Reserve these for moments that are occasional and
mean something — a check on a completed verification, a pin when a location
resolves. Navigation chrome (chevrons, menus, back arrows) is seen hundreds
of times a day and should stay on plain `lucide-react`.
