---
name: bionic-regeneration
description: Use after changing code, ADRs, the journal or the research tree, before a release or commit, when asked whether bionic/ is up to date, "regenerate the docs", "arch or code docs drift", "run derive-arch", "check-drift", or before touching anything under bionic/arch/, bionic/code/ or a generated index. Says what bionic/ generates versus what a human writes, which regenerator owns each output, how to check drift without writing, the safe repair order, and this repository's known gaps.
---

# Bionic regeneration

Thin procedure over the Crux regenerators. It holds no generator logic; each
generator is a script in the Crux plugin (`${CRUX_PLUGIN_ROOT}/scripts/`) with a
skill wrapper. Catalog of the Crux skills and conventions:
https://bionic-coding.com/crux/catalog/ (the pages for `derive-arch`,
`extract-code-docs`, `verify-code-docs`, `check-drift`, `audit-docs`).

Set `CRUX_PLUGIN_ROOT` first: in Claude Code the value of `CLAUDE_PLUGIN_ROOT`;
otherwise the installed plugin directory (here
`~/.claude/plugins/cache/crux/crux/<version>`). Run every command from the
repository root. The docs directory is `bionic` (`bionic/manifest.yml`).

## How regeneration works

1. Each derived output has a **regenerator** (a script) that reads project
   sources and **rewrites the whole output**. It never merges. A manual edit to a
   generated file is therefore lost on the next run, and is itself a defect.
2. Each regenerator has a **`--dry-run`**: it derives in memory, compares with
   what is on disk (a recorded hash for the arch spine, a page-by-page diff for
   code docs) and reports drift. **Exit 1 with a JSON `drift` (a list on some gates, `true` or a
   `diff` on others) means drifted; exit 0 means in sync.** Parse stdout as JSON whatever the exit code, and never
   wrap a gate in `|| true`.
3. The skills split two ways: **check** (`check-drift`, `verify-code-docs`,
   `derive-arch --dry-run`) writes nothing; **repair** (`derive-arch`,
   `extract-code-docs`, `generate-*`, `compile-doctrine`, `audit-docs` for safe
   additive fixes) regenerates. A check names the repair; it never runs it.
4. Regeneration reads sources, so the answer to "is it current" changes the
   moment code changes. Drift after a code change is the expected state, not a
   fault.

## What is generated and what is written by hand

| Path | Kind | Owner (repair) | Check |
|---|---|---|---|
| `bionic/arch/` (spine: overview, module-graph, api-surface, data-model, decision-index, `_meta/`) | generated | `pnpm docs:arch` | `pnpm docs:arch:check` |
| `bionic/code/` (per-file pages, `_meta/`) | generated | `uv run --no-config extract-code-docs.py --config bionic/manifest.yml` | same with `--dry-run` (or skill `verify-code-docs`) |
| `bionic/adrs/index.md` | generated | `generate-adr-index.py` | `--dry-run` |
| `bionic/adrs/summaries/` | generated | `summarize-adrs.py` | `--dry-run` |
| `bionic/adrs/doctrine/` | generated | `compile-doctrine.py` | `--dry-run` |
| `bionic/adrs/lineage.md` | generated | `generate-lineage.py` | `--dry-run` |
| `bionic/adrs/reviews/index.md` | generated | `generate-reviews-index.py` | `--dry-run` |
| `bionic/index.md` `## ADRs` rollup | generated region | `generate-index-rollup.py` | `--dry-run` |
| `bionic/journal/index.md` | generated | `generate-journal-index.py` | `--dry-run` |
| ADR bodies, briefs, research pages, journal entries, `objectives.md`, `manifest.yml`, `inbox/`, `invariants/`, `promptbooks/` | hand-authored | skills such as `propose-adr`, `log-work`, `propose-brief` | `audit-docs` |

If a file's header or its `_meta` says generated, treat it as generated. Fix the
source or the extractor configuration, then regenerate. Never edit the output.

## When to run what

| Situation | Do |
|---|---|
| Source code changed (any `apps/`, `packages/`, `products/` TypeScript) | Check `arch/` and `code/`; regenerate those that drift before the work is called finished |
| An ADR was proposed, accepted, superseded or edited | Regenerate the ADR-derived outputs (index, summaries, doctrine, lineage), then `arch/` (its decision index reads ADR tags) |
| A journal entry or review report was written | `generate-journal-index.py` / `generate-reviews-index.py` (the writing skill usually does this; confirm with `--dry-run`) |
| Extractor or `bionic/manifest.yml` `code.extractors` globs changed | Regenerate `code/` and `arch/` |
| Before a release or a long unattended run ends | Run every gate (below) and report the table |
| Someone hand-edited a generated file | Revert the edit, fix the source, regenerate |

## Procedure

1. **Read first**: `bionic/objectives.md` and `bionic/AGENTS.md` (the tree's rules).
2. **Check, writing nothing**, in this order, and keep each exit code and drift
   count:
   - `pnpm docs:arch:check` (derive-arch `--dry-run` with the extractor flag)
   - `uv run --no-config "$CRUX_PLUGIN_ROOT/scripts/extract-code-docs.py" --dry-run --config bionic/manifest.yml`
   - each `generate-*.py --dry-run`, `summarize-adrs.py --dry-run`,
     `compile-doctrine.py --dry-run` from the table above, or the `check-drift`
     skill, which runs the whole roster in one read-only pass.
3. **Repair only what drifted**, ADR-derived outputs first, then `code/`, then
   `arch/`, then the index rollups. Use the regenerator named in the table.
   The `derive-arch` and `extract-code-docs` skills run as forked agents; running
   the script directly is equivalent.
4. **Re-check**: every gate you repaired must now exit 0.
5. **Look at the diff** (`git diff --stat bionic/`): a regeneration that rewrites
   hundreds of pages after a small change means the extractor, glob or source set
   moved, so find out why before committing.
6. **Record** a real regeneration with `log-work` (journal) when it was part of
   meaningful work; a routine check needs no entry.

## Failure modes

- **Exit 1, `drift`**: drifted. Run the repair, then re-check.
- **Exit 1, `strict_failures`** (arch): a required concern was not populated
  (see the `coverage` array). Drift repair does not fix it; the source or
  extractor must change.
- **Exit 2** (arch): a spine file refuses to project from a gated artifact that
  is not what its own regenerator produces. Regenerate that artifact first.
- **Configuration or content refusal** (`code/`): an extractor name not shipped,
  or a glob matching nothing. Fix `bionic/manifest.yml`.
- **Stale dist or half-edited code**: regenerating while other work is mid-edit
  records a half-finished picture. Regenerate after the code settles.

## Known gaps in THIS repository (measured 2026-10-05)

- **`arch/data-model` comes from a project extractor, and Crux only runs it with a flag.**
  Crux has no Drizzle reader. `.bionic.yml` `arch_extractors` points at
  `tools/crux/arch/drizzle_data_model.py`, which statically reads the newest
  `packages/database/drizzle/2*/snapshot.json` (no drizzle-kit, database or app
  code) and renders tables, enums, indexes, relations, per-table RLS policy
  names and named residuals (policy expressions, checks). Crux runs overrides
  only when `CRUX_ARCH_ALLOW_OVERRIDES=1`. **Use `pnpm docs:arch` (regenerate)
  and `pnpm docs:arch:check` (dry run); they set the flag.** A raw
  `derive-arch`, `audit-docs` or `check-drift` without the flag (prefix that one
  command with `CRUX_ARCH_ALLOW_OVERRIDES=1`, or use the scripts) ignores the extractor, writes data-model as a stub and flips
  the spine hash: false drift. `scripts/arch-extractor.test.ts` fails with that
  explanation when the committed page is a stub, and when it differs
  from a fresh extraction. **Never `export CRUX_ARCH_ALLOW_OVERRIDES=1` in a
  shell profile:** the flag makes Crux run a repository's own Python, so a
  profile export does that in every repository an agent derives in and defeats
  Crux's opt-in for untrusted checkouts. The safest scoping is per command
  (also for any `.claude/settings.json` env idea, which stays an owner decision). After generating a Drizzle
  migration run `pnpm docs:arch`. The structural fix is an upstream native
  Drizzle rung: `bionic/inbox/crux-feature-request-drizzle.md`.
- **`code/` uses the generic `fallback` extractor** (no TypeScript-aware
  extractor shipped), and its glob includes test kits and fixtures, so pages
  exist for files such as `live-script-kit.ts`.
- **Crux's arch and code scanners ignore `.gitignore`.** They skip only
  dot-directories and a fixed list (`node_modules`, `dist`, `build`...), so
  gitignored machine-local folders (Playwright `test-results` and
  `playwright-report`, `apps/web/public/ocr`) get indexed into `bionic/arch` and
  `bionic/code`, and the committed map drifts on a fresh clone or in CI. Keep
  such outputs in dot-directories (the e2e follow-up moves Playwright's), and
  before deriving run `rm -rf apps/web/public/ocr` (the OCR assets are copied
  back on the next web build). Upstream request (second one):
  `bionic/inbox/crux-feature-request-drizzle.md`.
- **No bionic drift gate runs automatically.** `lefthook.yml` runs lint and
  format on commit and `pnpm verify` on push; neither runs the regenerators'
  `--dry-run`, and there is no CI directory. Drift is found only when an agent
  or person runs the checks. Wiring a gate is a hook change and needs the
  owner's decision.

## Red flags

- About to edit a file under `bionic/arch/` or `bionic/code/` (or a generated
  index) by hand. Change the source, then regenerate.
- About to run a repair in the middle of other workers' edits, or without a
  fresh check showing what drifts.
- About to hide a non-zero dry-run exit, or to describe a gate as clean without
  its exit code.
- About to bump or invent a hash, or to copy `_meta/` content by hand.
- About to run `derive-arch`, `check-drift` or `audit-docs` directly without a per-command `CRUX_ARCH_ALLOW_OVERRIDES=1` prefix, to `export` that flag in a shell profile, or to generate a Drizzle migration without running `pnpm docs:arch`.

## Verification checklist

- [ ] Every gate you ran has its exit code and drift count in your report.
- [ ] Each repaired gate now exits 0 on a re-run.
- [ ] No generated file was edited by hand; `git diff` shows only regenerated output.
- [ ] The diff size was sane for the change, or its cause is understood.
- [ ] A real regeneration was journaled with `log-work` when it mattered.
