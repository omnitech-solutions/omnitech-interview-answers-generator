# Non-technical briefing implementation verification

Implemented on `feat/non-technical-briefings` in the managed `interview-briefings` worktree. Additional changes after the operator's isolation request stayed in that worktree. The original checkout was not reset or cleaned; it retains the earlier partial work and concurrent changes.

## Delivered behavior

The Interview preparation workspace imports private versioned candidate matrices, accepts interview context and questions, produces reviewable proposals, applies against the expected draft revision, and saves complete briefing packs. Answers have three talking points, source references and explicit gaps. New packs and saved-pack reopening are supported. Shared contracts/client/CLI and both Next and local API hosts use the same backend. Technical draft JSON remains unchanged when no briefing is present.

At the operator's request, the supplied Desktop matrix is the local default. Exact byte copies are stored with mode 0600 in ignored `.data/default-experience-matrix.json` and `apps/web/.data/default-experience-matrix.json`. No private matrix is tracked. On an empty local account, the host seeds `local-experience-matrix`; new packs select it automatically. Existing profiles and saved profile revisions are not replaced. Production loading is disabled. Next resolves the actual bootstrapped local identity rather than assuming fixed database UUIDs.

## Checks performed

`pnpm verify` passed on the final implementation: lint, format, 55 typecheck tasks, 67 test files / 456 tests, coverage, and 32 build tasks. Coverage: statements 90.12%, branches 81.34%, functions 91.06%, lines 91.8%. No thresholds were lowered. The build emitted dependency module-directive warnings; the command succeeded. Log: `/tmp/interview-briefings-final-verify.log`.

`pnpm rulesync:generate` regenerated compatibility outputs; `pnpm rulesync:verify` returned `.codex verified: 10 commands, 17 skills`. Generated compatibility files remain ignored. `git diff --check` passed. `git ls-files .data apps/web/.data` returned no tracked paths; `git check-ignore` confirmed both default copies are excluded.

An isolated Next browser session completed synthetic profile preview/import, proposal generation, Apply, Save and reload. A fresh isolated database/browser session showed **My experience matrix · revision 1** selected by default using the supplied file. Screenshot: worktree `.superpowers/sdd/2026-10-01-non-technical-interview-briefings/default-matrix.png`. No external model was called.

An isolated real local API process, disposable PostgreSQL and loopback fake model completed default-profile loading, synthetic import, proposal generation, Apply, Save and reload. Output: `LOCAL HOST PASS: default profile, synthetic import, proposal, Apply, Save, reload.` Log: `/tmp/interview-briefings-local-host.log`. Both owned test servers and their PostgreSQL processes were stopped.

Regression tests cover malformed imports, scope isolation, immutable revisions, bad hashes/quotes/metrics, qualifier preservation, stale revisions, revoked-source reads/writes, atomic PUT/Apply/Save locking, provider failures, refinement target/context checks, full-pack save, default selection, and dirty-navigation confirmation. Deliberate failing tests preceded fixes; the run reports under `.superpowers/sdd/2026-10-01-non-technical-interview-briefings/` record red/green evidence.

## Corrections and implementation decisions

- The additive optional `briefing` field preserves existing coding payloads; defaulting it to null changed old JSON equality and was removed after the existing combined assistant tests failed.
- Exactly three talking points use an array length constraint. The first tuple schema failed the existing assistant's strict JSON Schema compiler; application validation retains the same cardinality after the fix.
- Origin validation uses the request Host because Next can canonicalize the URL hostname. A same-origin browser POST initially returned 403; the host-origin regression failed before the fix and passed afterward. Cross-site requests remain rejected.
- Source-qualified metrics retain lower bounds and ranges. Profile read authorization and derived writes share a transaction lock so revocation cannot race between validation and persistence.
- Private profile versions and proposal snapshots are separate from public Knowledge. Drafts and saved packs reuse the existing workspace repository. The operator runbook records the final routes and deviations from the original proposal.
- The managed worktree lacks the sibling UI package used by the existing link dependency. Verification used a worktree-local ignored copy of that already-built package under `node_modules/.briefing-ui-package`; no tracked dependency replacement was made.

## Not done

No deployment, push, external provider request, or paid model evaluation. Semantic truth of arbitrary generated prose is not proven by source-link validation; candidate review remains necessary. Full two-host browser coverage and Docker coding-runner execution were not performed: the Next browser and real local API were exercised separately, while deterministic coding/assistant regression tests passed. The operator's existing local frontend on port 5175 was left running and untouched. The current original-checkout server does not automatically pick up this worktree's changes.
