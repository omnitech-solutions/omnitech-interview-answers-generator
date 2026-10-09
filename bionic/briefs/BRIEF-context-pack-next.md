---
title: "The context pack after its first slice: extraction, stored identity, the other readers and the views"
slug: context-pack-next
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [context, engine, documents]
related_adrs: []
---

# The context pack after its first slice: extraction, stored identity, the other readers and the views

## Where it stands

The first slice (ADR-0041) prepares the experience matrix, the employer brief and the
preferences into records, resolves three projections, and feeds the coach and one view. Five
things in ADR-0038 are not built. Each is described by what you would see when it is.

| Item | Today | When built | Needs from the owner |
|---|---|---|---|
| **Extraction from the job posting and notes** | Only the model-cleaned brief is read; the raw posting and your notes reach the coach not at all | The posting and notes are read once by a model into requirements and facts, each with the sentence it came from; an invented requirement is rejected because its quote is not in the text | Where the prepared result is kept (below) |
| **Stored identity** | A record is named from employer, title and its text. Rewording a proof point makes it a new record, so a pin or a citation to the old one is lost | Each role and fact gets an id when the matrix is imported or edited, kept in the matrix itself; rewording keeps the id | Agreement that the matrix gains an `id` on each role and fact |
| **The other readers** | Live answers, the briefing and documents each select with their own older code, so the same question can pick different roles in different places | All of them read a projection of the pack; the five differences listed in ADR-0038 disappear | The order (recommended: live answers, then documents, then the briefing) |
| **Coverage, citation and pivot views** | One view: what was selected for a question | Coverage: each requirement of the posting and whether your record covers it. Citation: each sentence of a written answer or document and the fact behind it, marked exact, near or not found. Pivot: your facts by technology, by employer, by kind of question | Which first (recommended: coverage, it is what tells you what to prepare) |
| **Your pins and exclusions** | None | "Always use this story for conflict"; "never mention this project" | Nothing |

## The decision that blocks extraction

Extraction costs a model call per source, so its result must be kept. The engine keeps prepared
context in its own tables. Three places they could live:

- **A. The engine's own database** (as now for run records, on port 54329). Nothing changes in
  Studio's database; but prepared context is tenant-owned content sitting outside Studio's row
  security and backups.
- **B. Studio's Postgres, in its own schema, under Studio's migrations and row security.**
  Recommended: one database, one backup, tenant rules enforced the same way. Needs a schema
  name (the engine's default `ai` is taken) and a migration.
- **C. Keep nothing; extract in memory per session.** No decision needed; pays the extraction
  again on every restart and cannot be inspected later.

## The four choices already recorded (ADR-0041), for review

See the todo; each can be overruled without rework elsewhere.
