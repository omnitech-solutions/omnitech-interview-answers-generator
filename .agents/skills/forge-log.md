# Forge log

_Written by forge-skill. Entries newest-first. Events: authored | revised | used | evaluated | fallback | escalated | pruned. forge-skill is the sole writer of the lifecycle events (authored, revised, pruned); the usage events (used, evaluated, fallback, escalated) are written by the session that used the forged skill, in forge-skill's locked format._

## [2026-10-05 03:13] revised | technology-references
- Changed: Drizzle no longer routes to the official docs URL alone; the skill now lists the filed `drizzle-*` source pages and adds a per-layer Drizzle line (read the sources and the three invariants, generate through `db:generate`, finish with `pnpm docs:arch` then `pnpm docs:arch:check`); no rule text was added.
- Self-test: every path and script the new line names was checked against the repo (`db:generate` in `packages/database/package.json`, `docs:arch` scripts in the root `package.json`, the six source pages); the router was not run on a live Drizzle task.
- Learned: the map row, not the skill, is where the Drizzle notes belong, so the skill stays thin and a version upgrade touches only the research wiki.

## [2026-10-05 02:49] revised | bionic-regeneration
- Changed: the known-gaps and commands now describe the project arch_extractors override for data-model (a Python extractor reading the newest Drizzle snapshot) instead of the retired Prisma projection, the pnpm docs:arch scripts that set the override flag, and the hazard that a raw derive-arch run without the flag regenerates a stub; self-test: pnpm docs:arch:check exits 0 after a real derive and the guard test passes.
- Learned: Crux already ships a per-concern override seam, so the earlier committed-projection workaround was avoidable, and the override flag is the weak point, so the guard that fails loudly on a stub is what makes it safe.

## [2026-10-05 01:48] revised | bionic-regeneration
- Changed: the known-gaps section now records that arch/data-model is populated from a committed Prisma-syntax projection of the Drizzle snapshot, with the regeneration command and the order (db:projection, then derive-arch); verified by the real derive-arch (populated, no strict failures) and the projection guard tests.
- Learned: Crux has no project extension point for the data-model concern, so the update-proof route is to feed its Prisma rung a committed projection and guard that file in the repo's own tests.

## [2026-10-05 01:31] authored | bionic-regeneration
- Gap: agents had no project procedure for when and how to check and regenerate the derived parts of bionic/ (arch, code, ADR indexes) or what never to hand-edit; the skill carries the generated-versus-authored table, the gate roster and repair order, and this repository's known gaps.
- Self-test: ran every read-only check the skill names on the live tree (7 regenerator dry-runs plus derive-arch and extract-code-docs): all scripts exist, none wrote anything, and they found real drift (arch, code, ADR summaries, doctrine, lineage); the repair path was not run (deferred to the real regeneration before the final report), confidence about 78 percent (closed-with-caveats).
- Learned: gates do not share one drift shape (a list on some, a boolean or a diff on others), and derive-arch cannot see Drizzle tables, so arch/data-model stays a stub here.

## [2026-10-04 20:30] authored | technology-references
- Gap: layer audits and implementers had no technology references; the skill routes them to the layer-to-reference research page.
- Self-test: read-through against the map page found every named source page and ADR link resolving and no rule text copied; the router was not run on a live task, confidence about 75 percent (closed-with-caveats).
- Learned: two Vercel skills share one upstream repo whose root has no LICENSE file, so the MIT claim rests on skill metadata and the README only.
