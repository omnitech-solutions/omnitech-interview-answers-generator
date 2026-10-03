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

Claude Code, Codex and OpenCode all work in this repository. Each needs the
same instructions and the same project skills, and every decision, plan and
review needs one place to live. The repository's documentation tree is
`bionic/`, operated by crux ([[adrs/ADR-0000-record-architecture-decisions]]).

## Decision

Crux is the AI development workflow for this repository.

1. **Workflow.** Architecture and feature work uses crux: `whiteboarding` to
   explore, `propose-brief` and `propose-adr` to record, then `dev-cycle`,
   `iterate`, `patch-cycle` or `fix-directly` by size. Review uses the crux
   reviewer. The committed `.claude/settings.json` keeps crux the only
   development-workflow plugin enabled for the project.
2. **One instruction file.** The hand-authored repository-root `AGENTS.md` is
   the single instruction file. Claude Code (2.1.277 or later), Codex and
   OpenCode read it natively.
3. **Skills live once.** Project skills live in `.agents/skills/`;
   `.claude/skills` and `.opencode/skills` are symbolic links to it.
4. **Nothing is generated.** No tool generates instruction files or skills;
   they are edited directly.
5. **Product skills.** The project skills are the product skills: `/answer`,
   `/explain`, `/playground*`, `/mock-interview*`, the `interview-*` skills,
   `ai-provider-maintainer`, and the `/verify` gate.
6. **One documentation tree.** `bionic/` holds the decisions, research,
   journal, promptbooks and invariants.

## Consequences

**Positive:**
- One instruction file and one skill folder serve every supported host, with
  nothing to regenerate.
- Every decision, plan and review has one home in `bionic/`.

**Negative:**
- Only hosts that read `AGENTS.md` and the linked skill folders are supported.
- Claude Code older than 2.1.277 does not read `AGENTS.md` natively.

## References

- Repository-root `AGENTS.md` ("Development workflow").
- `.agents/skills/`, `.claude/skills`, `.opencode/skills`, `.claude/settings.json`.
- `.bionic.yml` and `bionic/AGENTS.md` (crux operational schema).
- [[adrs/ADR-0000-record-architecture-decisions]]
