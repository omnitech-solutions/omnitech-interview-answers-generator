---
id: ADR-0001
title: "Crux is the sole AI development workflow"
status: Proposed
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [process, tooling, agents, crux]
related_briefs: []
related_research: []
---

# ADR-0001 — Crux is the sole AI development workflow

## Context

Four overlapping systems shaped how AI agents worked in this repository:

- **Rulesync.** `.rulesync/**` was the single editable source for rules,
  commands and skills. A generator wrote per-host copies into `.agents`,
  `.claude`, `.cursor`, `.codex` and `.opencode`, with a Codex-specific
  generator package (`@omnitech/interview-rulesync-codex`). The engineering
  contract said to edit only `.rulesync/**` and regenerate (former
  `.rulesync/rules/base.md` and `overview.md`, commit `4c50c5e`).
- **Superpowers.** The superpowers plugin supplied brainstorm, plan and
  execute skills.
- **Repository planning skills.** `overview.md` routed architecture work through
  the repo's own `codebase-audit` skill and the `planning` skill / `/plan`
  command to produce a "decision-complete blueprint".
- **Crux** was bootstrapped into `bionic/` (commit `4c50c5e`) and owns
  decisions, research, the journal, promptbooks and invariants.

Running them together gave agents two planning workflows, two places to record a
decision, and generated instruction files that had to be regenerated after
every rule edit. The owner chose to make crux the only workflow and to move all
documentation into `bionic/`.

## Decision

Crux is the only AI development workflow in this repository.

1. **Instructions.** One hand-authored repository-root `AGENTS.md` carries the
   instructions every agent reads. It is read natively by Claude Code
   (2.1.277 or later), Codex and OpenCode. `CLAUDE.md` is removed. No
   instruction file is generated.
2. **Project skills.** Project skills live once, in `.agents/skills/`.
   `.claude/skills` and `.opencode/skills` are symbolic links to it.
3. **Removed tooling.** Rulesync, its configuration, its generated outputs, the
   `@omnitech/interview-rulesync-codex` package and Cursor support are removed.
4. **Superpowers.** The superpowers plugin is disabled for this project in the
   committed `.claude/settings.json`.
5. **Planning and review.** The repository's `planning` and `codebase-audit`
   skills and the `/plan` command are retired. Architecture and feature work
   uses crux: `whiteboarding` to explore, `propose-adr` to decide, then
   `dev-cycle`, `iterate`, `patch-cycle` or `fix-directly` by size; review uses
   the crux reviewer.
6. **Retained product skills.** The product skills stay: `/answer`, `/explain`,
   `/playground*`, `/mock-interview*`, the `interview-*` skills,
   `ai-provider-maintainer`, and the `/verify` gate.
7. **Documentation.** `bionic/` is the one documentation tree. The former
   `docs/` and `devdocs/` content is filed there as ADRs and research pages,
   and both directories are removed.

## Alternatives Considered

### Option A — Keep rulesync as the generator and add crux beside it
- **Pros:** No migration of instruction files; Cursor support kept.
- **Cons:** Two sources of truth for agent instructions; every rule edit needs
  a regeneration step; superpowers and crux planning compete.
- **Why not:** The duplication is the problem this decision removes.

### Option B — Keep superpowers for planning and crux only for records
- **Pros:** Familiar brainstorm/plan/execute loop.
- **Cons:** Plans and decisions land in different places; crux's council,
  review and invariant gates are bypassed.
- **Why not:** A decision made outside crux leaves no ADR or promptbook trail.

### Option C — Per-host instruction files maintained by hand
- **Pros:** No generator.
- **Cons:** `CLAUDE.md`, `AGENTS.md` and host skill folders drift apart.
- **Why not:** The three supported hosts all read `AGENTS.md`, so one file
  suffices.

## Consequences

**Positive:**
- One instruction file and one skill folder; nothing to regenerate.
- Every decision, plan and review has one home in `bionic/`.

**Negative:**
- Cursor is no longer supported.
- Claude Code older than 2.1.277 does not read `AGENTS.md` natively.
- The retired `planning` / `codebase-audit` habits must be relearned as crux
  workflows.

**Follow-on work:**
- Rewrite the root `AGENTS.md` to carry the architecture rules recorded in
  ADR-0002 to ADR-0008 and to point at `bionic/AGENTS.md`.
- Repoint README links that targeted `docs/` or `devdocs/`.

## References

- Former `.rulesync/rules/base.md` and `.rulesync/rules/overview.md` (commit `4c50c5e`).
- [[adrs/ADR-0000-record-architecture-decisions]]
- Crux operational schema: `bionic/AGENTS.md`.
