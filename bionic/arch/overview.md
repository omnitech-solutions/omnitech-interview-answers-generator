# Architecture overview

<!-- arch-spine-hash: sha256:fd7fc59d637bc5c92d306935e009bb3d826834e40785dc434d329240912a76eb -->

_Derived from the spine; regenerated whenever the spine moves. Stands on its own; ADR references live in `decision-index.md` as footnotes._

_Stack pack: `node` (auto-detected)._

## Shape

- **Data model:** see `data-model.md`.
- **Interface surface:** see `api-surface.md`.
- **Module structure:** see `module-graph.md`.
- **Decisions:** 18 Accepted, non-archived decisions (see `decision-index.md`).

## How to read this

This tree IS the architecture, derived and kept current — not documentation. The four spine files are regenerated wholesale and byte-stable; this overview is synthesized from them. A drift-gate stamps the spine hash above; `derive-arch.py --dry-run` fails when the spine moved without a re-derive.
