# KangaruRide

<!-- AIOS link. Added 2026-08-29. Keep this section at the top. -->

## This project is registered in the AIOS

Rio's operating system and long-term memory live at **`D:\OS`**. This project
is not an island: what is learned here is recorded there, and the standards
that govern the work are installed machine-wide.

**Its knowledge base is `D:\OS\kangaru-os\`.** Read `D:\OS\kangaru-os\index.md`
before answering anything about this project's status, client, commercials or
history. Do not re-derive from the code what the wiki already records.

**Before starting work, read:**

1. `D:\OS\kangaru-os\index.md`, then `D:\OS\kangaru-os\CLAUDE.md`
2. `~/.claude/skills/` — the standards that govern every project on this
   machine. `worklog` before your first edit, then
   `engineering-standards` / `wordpress` / `screen` / `ui-performance` as the
   work demands.

**Before finishing, use `self-improve`:**

| What you learned | Where it goes |
|---|---|
| A rule for all projects | `~/.claude/skills/` |
| A rule for this project only | this file, or `AGENTS.md` |
| An architectural decision | `docs/adr/` in this repo |
| A business decision | `D:\OS\decisions\log.md` |
| A fact about the client, money or status | `D:\OS\kangaru-os\` as a wiki page |
| Session state, gotchas, what you did NOT build | the worklog in this repo |

**The trigger is the second time.** First occurrence is an incident. Second is
a pattern, and a pattern belongs in a standard.

## This project's own standards outrank everything above

**Read `AGENTS.md` in full.** It is the authority for this repository and it wins over any machine-wide skill where the two disagree. Also read `PRODUCT.md`, `DESIGN.md`, `docs/screen-rules.md`, `docs/agent-worklog.md` and the relevant ADR in `docs/adr/` (there are 67). `docs/agent-worklog.md` is the collision protocol for parallel agents and claiming your files there before the first edit is not optional.

## The code graph

This repo carries a **Graphify** code graph at `graphify-out/` — local
tree-sitter AST, no LLM tokens, nothing leaves the machine.

```bash
graphify query "how does X work"   # traversal, token-budgeted
graphify explain "ClassName"       # a node and its neighbours
graphify affected "ClassName"      # what breaks if this changes
graphify god-nodes --top 10        # architectural hubs
graphify update . --no-cluster     # refresh after code changes (free, fast)
```

**Precedence.** The graph answers *structure* only. For status, client,
commercials, history and decisions, `D:\OS\kangaru-os\index.md` still comes first, and this
repo's own docs outrank anything inferred from code. Never let a graph query
replace reading the wiki.

If `GRAPH_REPORT.md` says the graph was built from an older commit, run
`graphify update . --no-cluster` before trusting it. Setup notes and the two
known traps are in `D:\OS\references\code-graph.md`.
