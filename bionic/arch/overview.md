# Architecture overview

<!-- arch-spine-hash: sha256:ae5e9adc13312d90be20a8d4ed25dffd20a6628e2af1a3d3a6c397af1eed1d0a -->

_Derived from the spine; regenerated whenever the spine moves. Stands on its own; ADR references live in `decision-index.md` as footnotes._

_Stack pack: `node` (auto-detected)._

## Shape

- **Data model:** see `data-model.md`.
- **Interface surface:** see `api-surface.md`.
- **Module structure:** see `module-graph.md`.
- **Decisions:** 6 Accepted, non-archived decisions (see `decision-index.md`).

## How to read this

This tree IS the architecture, derived and kept current — not documentation. The four spine files are regenerated wholesale and byte-stable; this overview is synthesized from them. A drift-gate stamps the spine hash above; `derive-arch.py --dry-run` fails when the spine moved without a re-derive.
