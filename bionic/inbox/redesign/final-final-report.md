# Final final report: Active Session, 2026-10-05

Branch `feat/active-session`, 21 commits ahead of `master`, **not pushed** (the table below lists the 7 from this session's last stretch).
Start with this page; it points at everything else. The long report is
[final-report.md](final-report.md) (status, 39-row manual test matrix M1-M39,
open items 1-14). The running ledger is [plan.md](plan.md). Both stay the
detailed record; this page is the index.

## What changed since the last report

| Commit | What |
| --- | --- |
| `5d416bd` | The redesign itself (screenshots, revisions, See-through, capture policy, data model). |
| `f3250a9` | Migration test derives its expected list from the folders (it was flaky); final report. |
| `3ae02b9` | WebKit e2e never reaches the real microphone (the macOS "Allow microphone" dialog); `E2E_LIVE=1` live reporter; boot-time pending-migration check follow-ups. |
| `d66da17` | Browser suite runs as **4 parallel shards** by default (`E2E_SHARDS`). |
| `47050af` | `.env.example` reorganised into 14 numbered sections; README rewritten as a from-scratch path. |
| `2b0d19d`, `ab74035` | Official-docs technology audit (worker) plus the lead's independent review. |

## How well each claim is evidenced

| Claim | Evidence | Not shown |
| --- | --- | --- |
| Gate green | `pnpm verify` exited 0 on the final tree `ab74035` (5015 tests passed, 2 skipped; build and native checks included), and earlier on `3ae02b9` and `d66da17`. | Nothing: this is the full gate on the tree you would push. |
| Microphone dialog fixed | You watched the stubbed WebKit run and saw no dialog. The 20 WebKit spec files pass with the stub. | Which spec caused it: you asked me to stop replicating, so it was never bisected. |
| Sharding works | One sharded run: 370 s against 19.1 min serial, all four shards on one build, 360 passed, 3 skipped, 1 failed (the ignored `glass-clear` flake). | More than one run; shard balance (2.8 to 6.2 min) is uneven; machine load under 4 stacks. |
| Boot-time migration check | Unit and DB-backed tests pass (worker refuses on pending/ahead; web only on a definite mismatch). | What `next start` does when `register()` throws: the Next docs do not say; unverified. |
| Docs audit | 84 findings, 17 provenance rows (worker); lead re-verified 9 top findings in the code. | About 75 findings only on the worker's word; nothing was run. |

## Open problems (honest list)

1. **Flaky tests are ignored by your decision (2026-10-05).** The one known case is `glass-clear` (WebKit): it failed in 2 of 4 runs with identical numbers (code-card contrast 0.138 vs 0.453, `glass-clear.spec.ts` ~line 364). The cause was not found and the test was left unchanged and enabled, so a sharded run can show it as the single failure.
2. **The native app has not been reinstalled on the final commits** (the installed build is `5d416bd+`). You need to quit it first. Your live testing M1-M39 is still yours.
3. **28 web claims are still pending** (`e2e/live-session/src/claims/claims.ts`; 170/198 covered).
4. **Rare native no-question "Drafting" marker** was never reproduced.
5. **F-OWNER**: the web message when the native app owns capture is misleading (a `test.fail()` marker, `cross-surface-sync.spec.ts:248`). Fix not decided.
6. **ADR-0004 to 0007 are still `Proposed`** while `AGENTS.md` cites them; two invariant records fail (`last_result: fail`, 2026-10-02).
7. **ADRs owed** for decisions D28-D38 (you pick which).
8. `docs:arch:check` drifts while `apps/web/public/ocr` exists (a known Crux scanner gap; delete the folder before `pnpm docs:arch`, restore with `node apps/web/scripts/copy-ocr-assets.mjs`). Upstream asks are drafted in `bionic/inbox/crux-feature-request-drizzle.md`.

## Decisions I need from you

- **Security fixes from the audit** (all small except the last two). In order of how much I'd do first: gate local sign-in on `NODE_ENV` too (`apps/web/auth.ts:10`, `sign-in/page.tsx:26`); fix the `/api/v1` token bypass (`products/interview/src/backend/api.ts:211-232`, changes the CLI contract); publish Postgres on `127.0.0.1` only (`compose.yaml:13`); header baseline (`apps/web/next.config.ts`); a CI job for the e2e suite; separating the migration role from the runtime role (needs an ADR).
- Accept or supersede ADR-0004..0007; refresh or fix the two failing invariants.
- Which ADRs for D28-D38.
- Whether to push, and whether to open a PR.

## Files to review, in the order I'd read them

**Start here**
1. `bionic/inbox/redesign/final-final-report.md` (this page).
2. `bionic/inbox/audit/technology-consistency.md`: the worker's audit, then "Lead review" at the end. The top-priority table is the decision list above.
3. `README.md` and `.env.example`: both rewritten; check that step 3 (choosing a model) reads right to you.

**The long record**
4. `bionic/inbox/redesign/final-report.md`: the 39-row manual matrix M1-M39 (what only you can test in the real native app), open items 1-14.
5. `bionic/inbox/redesign/plan.md`: sections 7.0x (migration check), 7.0y (microphone guard and the `glass-clear` correction), 7.0z (queue and the sharding result).
6. `bionic/objectives.md`: OBJ-7..OBJ-10 and the Shifts rows were added additively and are **pending your review** (`reviewed_at` not bumped).

**Code you may want to read**
7. `e2e/live-session/README.md`, `scripts/run.mjs`, `src/stack/stack.ts`, `src/stack/dist-dir.ts`, `src/stack/prebuild.ts`: sharding.
8. `e2e/live-session/src/fixtures/webkit-mic-guard.ts` and `src/fixtures/test.ts`: the microphone guard.
9. `e2e/live-session/src/reporters/live-reporter.ts`: the `E2E_LIVE=1` reporter.
10. `packages/database/src/migration-check.ts`, `migration-names.ts`, `apps/agent-worker/src/main.ts` (~line 363), `apps/web/instrumentation.ts` and `instrumentation-node.ts`: the boot-time check.
11. `packages/database/drizzle/20261005073811_screenshot_send/`: the one new migration.
12. `apps/studio-shell/Sources/**`: the native shell (capture policy, hit regions, OCR); `products/interview/src/frontend/studio/live/**` and `products/interview/src/backend/live-session/**`: the page and backend.

**Process and tooling**
13. `.agents/skills/bionic-regeneration/SKILL.md` and `.agents/skills/forge-log.md`: the project skill forged this session (`used`/`evaluated` log entries still owed).
14. `tools/crux/arch/drizzle_data_model.py`, `.bionic.yml`, `scripts/docs-arch.mjs`: how `bionic/arch/data-model.md` is generated. Upstream proposals: `bionic/inbox/crux-feature-request-drizzle.md`, `bionic/inbox/crux-arch-adapter-research.md`.

## How to run and test it

```bash
cp .env.example .env     # then choose a model in section 1
pnpm runner:build && pnpm dev     # open http://127.0.0.1:3000/t/local/p/interview
pnpm verify                       # the gate
E2E_LIVE=1 pnpm test:browser      # 4 shards; a timestamped START/END line per test
```
