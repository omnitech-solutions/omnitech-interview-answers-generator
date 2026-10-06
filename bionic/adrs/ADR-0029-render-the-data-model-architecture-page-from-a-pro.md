---
id: ADR-0029
title: "Render the data-model architecture page from a project extractor behind Crux's override seam"
status: Proposed
date: 2026-10-05
proposed_date: 2026-10-05
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [architecture, crux, documentation, drizzle, tooling]
related_briefs: []
related_research: []
---

# ADR-0029 — Render the data-model architecture page from a project extractor behind Crux's override seam

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

Crux's data-model detection knows Prisma, TypeORM, Sequelize and Mongoose but has no Drizzle reader, so `bionic/arch/data-model.md` regenerated as a stub and reported false drift. An earlier approach committed a generated Prisma-syntax projection of the Drizzle schema (plan D37); the owner preferred Crux's own extension point, done simply (plan D38). Crux's per-concern override (`arch_extractors` in `.bionic.yml`, resolved before the detected pack) runs project code only when `CRUX_ARCH_ALLOW_OVERRIDES=1`, which is Crux's deliberate trust boundary.

Source of the decision: plan decision D38 and `bionic/inbox/redesign/final-report.md` item 7 (decided 2026-10-05).

## Decision

1. **The page is derived from the committed schema snapshot.** `bionic/arch/data-model.md` is produced by a project extractor registered as the `data-model` override in `.bionic.yml`. It reads the newest committed Drizzle snapshot statically. It runs no database and no drizzle-kit, and it is deterministic.
2. **The override flag is scoped, never exported.** `CRUX_ARCH_ALLOW_OVERRIDES=1` is set only by the project's `pnpm docs:arch` and `pnpm docs:arch:check` scripts or as a per-command prefix. It is never exported in a shell session, because that would let Crux run repository code in every repository.
3. **A stub fails loudly.** A guard test fails, naming the flag, when the committed data-model page or its coverage is a stub, and when the committed page differs from a fresh extraction.
4. **The extractor states what it cannot show.** Policy expressions, checks and defaults are named as residuals rather than guessed.
5. **The structural fix is upstream.** A native Drizzle reader in Crux is requested in `bionic/inbox/crux-feature-request-drizzle.md`; this extractor is retired when it exists.

## Alternatives Considered

### Option A — A committed Prisma-syntax projection (plan D37)
- **Pros:** uses an existing Crux rung.
- **Cons:** a generated schema file in a foreign syntax, more files and guards.
- **Why not:** retired in favour of the override seam.

### Option B — Patch the Crux plugin cache
- **Pros:** none.
- **Cons:** lost on the next plugin update.
- **Why not:** not durable.

### Option C — Accept the stub
- **Pros:** nothing to maintain.
- **Cons:** the architecture map has no data model and shows false drift.
- **Why not:** the owner wanted the data model real.

## Consequences

**Positive:**
- The data-model page is real and its drift check is meaningful.

**Negative:**
- Project Python runs under Crux's flag; the flag must be kept per-command.
- Crux's scanners ignore `.gitignore`, so generated assets such as `apps/web/public/ocr` can cause false drift unless the scripts move them aside (tracked as the tooling work in `bionic/inbox/redesign/resolution-tracker.md`).

## References

- `.bionic.yml` (`arch_extractors`), `tools/crux/arch/drizzle_data_model.py`, `scripts/docs-arch.mjs`, `scripts/arch-extractor.test.ts`.
- [[research/references/technology-references]] and the `bionic-regeneration` skill (`.agents/skills/bionic-regeneration/`).
- `bionic/inbox/crux-feature-request-drizzle.md`
