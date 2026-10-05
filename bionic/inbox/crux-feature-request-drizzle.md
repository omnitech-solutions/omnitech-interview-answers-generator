# Feature request for Crux: a native Drizzle rung in the Node arch pack

Status: draft for the owner to file upstream (the public Crux repository takes
issues, not pull requests). Written 2026-10-05 from this repository's evidence.
Nothing here changes Crux; it is the proposal.

## The problem

`derive-arch` populates the `data-model` concern for a Node repository by trying
Prisma, then TypeORM, then Sequelize, then Mongoose (`node.py`, the data-model
probes). A repository on Drizzle ORM matches none of them, so the concern is
recorded as `stubbed` (no matching input) and `arch/data-model.md` stays empty,
even though the repository has a rich, committed, machine-readable schema.

This repository: 67 tables, 623 columns, 112 foreign keys (several composite on
`(tenant_id, id)`), 11 enums, 5 Postgres schemas, 104 row-level-security
policies, 41 indexes, all in the committed drizzle-kit snapshot
`packages/database/drizzle/<migration>/snapshot.json`.

## What works today and why it is not enough

A project-local `arch_extractors` override (ADR-0066) can fill the gap
(`tools/crux/arch/drizzle_data_model.py`). It works, but:

- it only runs with `CRUX_ARCH_ALLOW_OVERRIDES=1`; any process that runs
  `derive-arch`, `audit-docs` or `check-drift` without the flag ignores it,
  regenerates the concern as a stub, changes the spine hash and reports false
  drift, which is easy to do by accident;
- every Drizzle repository would have to write the same extractor.

## Proposal

Add a Drizzle probe to the Node pack's data-model ladder, static like the
others (no `drizzle-kit`, no database, no application code):

1. Detect: a committed drizzle-kit snapshot (`**/drizzle/**/snapshot.json` or
   `meta/*_snapshot.json`, both layouts exist across drizzle-kit versions) or
   `drizzle.config.*` naming an output folder.
2. Source: the newest snapshot (the authoritative DDL). Fallback, a tree-sitter
   TypeScript parse of `pgTable`/`mysqlTable`/`sqliteTable`/`pgSchema().table()`
   when no snapshot is committed.
3. Render the existing relational shape: `| table | column | type | nullable |
   primary key | references |`, schema-qualified table names, composite foreign
   keys attributed to every column they cover, `## Enums`, `## Indexes`,
   `## Relations`, and an honest `## Residuals` for what a snapshot cannot show.
4. Optional but valuable for multi-tenant repositories: a compact row-level
   security section (policies per table), since the snapshot carries them.
5. Hash the snapshot as the source, like Prisma's `schema.prisma`; add a corpus
   fixture and golden output beside the Prisma one.

Order: Drizzle before Prisma only if both are present and Drizzle's detection is
the more specific (a repository can hold both during a migration).

## Where it plugs in (from reading the engine; see crux-arch-adapter-research.md)

Register one more `Probe(_detect_node_drizzle, extract_node_data_model_drizzle,
kind="committed-artifact")` in `packs/node.py` `probes()["data-model"]`, add the
snapshot globs and the toolchain command to the Node pack's `INPUT_CLASSES`
data-model entry (`globs`, `artifact`, `refresh="drizzle-kit generate"`) so the
existing staleness advisory applies, extend `expected` to name the Drizzle
snapshot, and add a corpus fixture with a golden output beside the Prisma one.
Because the probe reads a committed artifact it needs no new parser pin and no
`regex-roster.yml` entry (that roster is only for `regex-over-source` probes).

## Reference implementation

This repository's extractor (stdlib-only Python, reads the newest snapshot) is a
working starting point and can be offered as the reference. Its tests assert the
column and table counts against the snapshot, every foreign key present, and
byte-identical output across runs.

## Second request: honour `.gitignore` (or an ignore list) in the arch and code scanners

The arch and code scanners skip only dot-directories and a fixed list
(`node_modules`, `dist`, `build`, ...) and ignore `.gitignore`. Gitignored,
machine-local folders (Playwright `test-results` and `playwright-report`, a
copied `apps/web/public/ocr`) are therefore indexed into `bionic/arch` and
`bionic/code`, so the committed map differs on a fresh clone or in CI.

Ask: skip paths that `git check-ignore` matches, or read an `ignore:` list from
`.bionic.yml` that both scanners honour. Workaround today: keep such outputs in
dot-directories and delete `apps/web/public/ocr` before deriving.
