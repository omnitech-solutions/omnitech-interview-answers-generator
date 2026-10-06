# Decision index

_Accepted, non-archived decisions (18), projected from `adrs/index.md`. ADR references are footnotes, never inline._

| # | decision | date | ref |
|---|---|---|---|
| 1 | Record architectural decisions as ADRs | 2026-10-02 | [^d1] |
| 2 | Crux is the sole AI development workflow | 2026-10-02 | [^d2] |
| 3 | Simplicity first: the least complex design that meets current requirements | 2026-10-02 | [^d3] |
| 4 | Keep package boundaries narrow with one public entrypoint per runtime surface | 2026-10-02 | [^d4] |
| 5 | Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security | 2026-10-05 | [^d5] |
| 6 | Keep login identities separate from connected provider accounts | 2026-10-05 | [^d6] |
| 7 | Interview answers are structured guides that render their Markdown | 2026-10-02 | [^d7] |
| 8 | Keep candidate documents in the Interview product | 2026-10-02 | [^d8] |
| 9 | Write documents in a few parallel calls on any language profile | 2026-10-03 | [^d9] |
| 10 | Host the Active Session processor in the agent worker behind a versioned wire contract | 2026-10-03 | [^d10] |
| 11 | Keep Active Session data private to the actor and enforce locality before dispatch | 2026-10-03 | [^d11] |
| 12 | Pause rather than end an Active Session on credential expiry or companion stop | 2026-10-03 | [^d12] |
| 13 | Use worker-owned agent sessions with one terminal outcome | 2026-10-03 | [^d13] |
| 14 | Run Active Session assistance on the worker executor with screenshots and two action slots | 2026-10-03 | [^d14] |
| 15 | Host the Active Session overlay as one route and isolate providers without emptying their home | 2026-10-03 | [^d15] |
| 16 | Capture on demand with masks and owner-requested companion captures | 2026-10-04 | [^d16] |
| 17 | Host the overlay in a native shell through one host adapter | 2026-10-04 | [^d17] |
| 18 | Use the query builder by default and check the database role on every tenant-scoped path | 2026-10-05 | [^d18] |

[^d1]: ADR-0000
[^d2]: ADR-0001
[^d3]: ADR-0002
[^d4]: ADR-0003
[^d5]: ADR-0005
[^d6]: ADR-0006
[^d7]: ADR-0008
[^d8]: ADR-0009
[^d9]: ADR-0010
[^d10]: ADR-0011
[^d11]: ADR-0012
[^d12]: ADR-0013
[^d13]: ADR-0014
[^d14]: ADR-0016
[^d15]: ADR-0017
[^d16]: ADR-0018
[^d17]: ADR-0019
[^d18]: ADR-0023
