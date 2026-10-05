# How Crux's arch engine adapts to a stack, and where Drizzle fits

Research note, 2026-10-05. Source: the installed Crux plugin 3.25.1
(`scripts/crux/arch/core.py`, `packs/node.py`, `regex-roster.yml`,
`bionic_config.py`, and the installed `bionic/AGENTS.md` §4). GitHub code search
was not used (it needs a login); the plugin source is the same code. Facts below
were read, not inferred; the "fit for us" section is judgement and says so.

## The adapter pattern: stack packs, probes, verdicts

- **Pack.** One module per stack under `crux/arch/packs/` (node, python, ruby,
  elixir, swift, crux). It exposes `detect(root) -> DetectResult(matched,
  markers)` (Node: a `package.json` at the root), an `INPUT_CLASSES` map and an
  ordered `probes()` registry. `PackEntry.beats` records pairwise precedence when
  two packs match at the same depth; `arch_stack:` in `.bionic.yml` pins one.
- **Probe.** `Probe(detect, extract, kind)`: a cheap detector plus an extractor
  with the one uniform contract `(root, docs_dir) -> (markdown, sources)`
  (`sources` = repo-relative file to sha256). Within a concern the first probe
  whose `detect` fires wins; each probe degrades to a stub on its own.
- **Node data-model ladder.** Prisma `schema.prisma`, then TypeORM `@Entity`,
  then Sequelize, then Mongoose. Drizzle is not on it.
- **Input class (ADR-0097).** Per concern: `expected` (the sentence a stub
  renders), `globs` (the declared input set: editing a file outside every
  concern's globs must never move the tree), `parser` (importable modules; a
  missing one is exit 2 with nothing written, never a stub), `artifact` and
  `refresh` (see below). Per probe: `kind` is `committed-artifact`, `parser`,
  `regex-over-source` or `stub`; the concern's class is the weakest in its chain.
  Prisma, TypeORM and Sequelize are `regex-over-source` and are named on
  `regex-roster.yml` with a `why_no_parser`; Mongoose is `parser`; Node's OpenAPI
  reader is `committed-artifact`.
- **Verdict.** Exactly one per concern: `populated(n_sources, n_entities)` (it
  refuses fewer than one entity) or `stubbed(reason)` with one of six closed
  reasons (`precondition_missing`, `unsupported_stack`, `no_entities`,
  `parse_failed`, and two more). An empty data model is therefore recorded
  `stubbed: no_entities`, never `populated`. Entities are counted by recognised
  table shapes; for data-model `| table | column |` (also `| field | type |` and
  `| type | kind |`).
- **Where it goes.** The rendered Markdown is the spine page; `sources` hashes and
  the pinned parser versions go into `arch/_meta/manifest.json` (byte-compared:
  that is the drift gate); the verdicts go into `arch/_meta/coverage.json`; the
  gates `arch.require` (manifest) and `--strict` read the verdicts.
- **Committed artifacts and staleness.** `artifact` names the globs that are the
  project toolchain's emitted file (Ruby `db/schema.rb`, Python `openapi.json`);
  with `refresh` it lets Crux ask "was a source committed after the artifact" and
  print a staleness advisory. The Prisma docstring calls `schema.prisma` "the
  committed projection, peer to Ruby's `db/schema.rb`".

## The override seam (ADR-0066)

Resolution per concern: project override, then the detected pack's probes, then
the stub. `.bionic.yml` `arch_extractors: {concern: 'rel/path.py:function'}`. It
runs only with `CRUX_ARCH_ALLOW_OVERRIDES=1`; otherwise Crux prints a notice and
falls through. The function takes exactly two positional parameters; a non-stub
result with empty `sources` is rejected; Crux hashes the extractor file into the
sources, so editing it drifts arch. The override counts as a `probe` in coverage.

## Fit for us (judgement)

- Our Drizzle snapshot is a `committed-artifact`: emitted by drizzle-kit, committed,
  machine-readable, exactly the class of Ruby's `db/schema.rb`. That is why the
  snapshot-reading extractor is the right shape, not a TypeScript parser.
- What an override does not get that a native probe would: an `InputClass` entry
  (so `globs`, `artifact`, `refresh` and the staleness advisory), and a `kind` on
  the record. Our guard tests and the repo invariant 'schema files and migrations
  agree' stand in for the staleness advisory.
- Native design to propose upstream: a Drizzle probe, `kind="committed-artifact"`,
  `artifact` globs for the snapshot, `refresh` naming `drizzle-kit generate`,
  first or right after Prisma in the Node data-model chain, rendering the same
  `| table | column | ... |` shape. The feature request draft carries this.
- The Prisma rung renders column defaults, `@@index`/`@@unique` notes, relations,
  enums, and residuals only for `@@map` renames, composite types, extra schema
  files and oversize input. Prisma's language cannot express policies, check
  constraints, roles, grants or triggers, so it renders none of them; our
  extractor renders row-level security and composite foreign keys on every
  covered column, and (since 2026-10-05) column defaults.
