# Resolution tracker: every item from the technology audit and the final report

Created 2026-10-05 by the lead. The owner said: "address all items that should be raised in the technology-consistency
document, include all items from final-report.md, you decide on the open items as you have more context."
Sources: `bionic/inbox/audit/technology-consistency.md` (A) and `bionic/inbox/redesign/final-report.md` section 6 (F).
Status values: DONE (verified), IN PROGRESS, QUEUED, DECIDED (a decision with no code change), VERIFY (an experiment),
OWNER (the one thing the lead will not decide). Each row is updated with evidence when its package reports.

## Work packages and waves
| Pkg | Wave | Scope | Owns (files) |
| --- | --- | --- | --- |
| NATIVE | 1 (running) | the Mac app's sign-in and start screens | `apps/studio-shell/**`, `live/overlay/**`, `api/native-auth/**` |
| WEB | 1 (running) | web sign-in, signed-out, account menu, fake-auth rules | `auth.ts`, `app/sign-in`, `src/platform/**`, `studio/**` (not overlay) |
| GOV | 1 | ADRs (accept, write), invariants, forge-log, rule wording | `bionic/**` only; sole creator of ADRs |
| DATA | 1 | owner/runtime role split, policy read, compose bind, init-script note | `packages/database/**`, `compose.yaml`, `docker/**` |
| TOOLING | 1 | CI workflow, `unstubEnvs`, vendor provenance, docs-arch gap | `.github/**`, `vitest.config.ts`, `vendor/README.md`, `scripts/docs-arch.mjs` |
| SEC | 1 | PKCE for integrations, `/api/v1` gate, request-id bound | `packages/platform-integrations/**`, `apps/web/app/api/integrations/**`, `products/interview/src/backend/api.ts` |
| WEB-HARDEN | 2 | headers, `global-error`, root `onError`, origin guard, `server-only`, auth secret/trustHost | `next.config.ts`, `app/**`, `src/platform/**`, `auth.ts` |
| QUALITY | 2 | Biome rules, catalog, Zod forms, isolatedModules, keys, model defaults | repo-wide (runs alone) |
| PRODUCT | 2 | F-OWNER, F8, pending claims, L-1, no-question regression test | `studio/live/**`, `live-session/**`, e2e |
| SWIFT | 2 | `@unchecked Sendable` invariants, navigation policy test | `apps/studio-shell/**`, `apps/capture-companion/**` |
| VERIFY | 2 | the UNVERIFIED experiments (below) | read-only plus scratch |

## A. Technology audit: every non-conforming or unverified finding
| ID | Decision | Pkg | Status |
| --- | --- | --- | --- |
| AU-SEC-02 passwordless local provider gated on the flag alone | FIX: loopback-only `local`, one predicate, `authorize` refuses non-loopback | WEB | IN PROGRESS |
| AU-SEC-01 committed dev fallback secret | FIX: refuse the fallback unless fake auth is on | WEB-HARDEN | QUEUED |
| AU-SEC-03 `trustHost: true` always | FIX: env-driven, safe default | WEB-HARDEN | QUEUED |
| AU-SEC-04 handoff cookie behind a TLS proxy | VERIFY with forwarded-proto simulation | VERIFY | QUEUED |
| AU-DEP-01 v5 beta, docs from main | DECIDED: record; re-capture docs at the beta tag on upgrade | GOV | QUEUED |
| DK-SEC-01 Postgres on all interfaces | FIX: `127.0.0.1:54320` | DATA | QUEUED |
| DK-BLD-01 floating image tags | DECIDED: accept (dev-only images, rebuilt by `pnpm runner:build`); reason recorded | GOV | QUEUED |
| DK-DAT-01 init script applies only to an empty volume | FIX: document in compose and README | DATA | QUEUED |
| PG-SEC-05 runtime role owns schemas and migrates | FIX: separate owner/migrator and runtime (DML-only) roles, with an ADR | DATA + GOV | QUEUED |
| PG-DAT-01 named lookup policies unread | VERIFY: read the policy bodies; fix if a race exists | DATA | QUEUED |
| HO-SEC-02 `/api/v1` token gate | DECIDED: KEEP the surface (CLI and api-client use it), HARDEN: fail closed, constant-time, never trust client headers alone | SEC | QUEUED |
| HO-SEC-01 no shared origin guard | FIX: one guard on mutating `/api/*` | WEB-HARDEN | QUEUED |
| HO-ERR-01 root `onError` missing | FIX | WEB-HARDEN | QUEUED |
| HO-SEC-03 request-id unbounded | FIX | SEC | QUEUED |
| NX-SEC-01 no security headers / CSP | DECIDED: static header set now (frame-ancestors self, nosniff, referrer-policy, permissions-policy); CSP DEFERRED: needs nonce, dynamic rendering, and allowances for the OCR worker, wasm and Mermaid, and would put the locked live panel at risk; plan recorded | WEB-HARDEN + GOV | QUEUED |
| NX-SEC-02 `x-powered-by` | FIX | WEB-HARDEN | QUEUED |
| NX-SEC-04 no `server-only` | FIX: markers on server-only entrypoints; tainting DECIDED no | WEB-HARDEN | QUEUED |
| NX-ERR-01 no `global-error` | FIX (fixed text, no content) | WEB-HARDEN | QUEUED |
| NX-ERR-03 SIGTERM interplay with Next shutdown | VERIFY under `next start` | VERIFY | QUEUED |
| NX-BLD-01 multi-instance hosting | DECIDED: no hosted target exists; revisit when one is chosen | GOV | QUEUED |
| BM-DEV-01 Biome `preset: none` | FIX in stages: correctness, suspicious, a11y, performance groups on; style group triaged; one commit per group | QUALITY | QUEUED |
| BM-DEV-02 no a11y or `noFloatingPromises` | FIX with BM-DEV-01 | QUALITY | QUEUED |
| PW-TST-04 e2e proves nothing automatically | FIX: CI workflow, `verify` job plus a sharded e2e job (PR and master); pre-push stays `verify` | TOOLING | QUEUED |
| PW-TST-03 shared stack, one worker | DECIDED: resolved by sharding (one stack per shard) | GOV | QUEUED |
| PW-TST-02 two `isVisible()` calls | FIX or justify | QUALITY | QUEUED |
| VT-TST-02 `unstubEnvs` | FIX: `unstubEnvs: true`, fix tests that relied on persistence | TOOLING | QUEUED |
| PN-DEP-01 catalog gaps (hono, drizzle, esbuild) | FIX | QUALITY | QUEUED |
| PN-DEP-02 vendored tarball provenance | FIX: `vendor/README.md` (source, build, refresh) | TOOLING | QUEUED |
| DR-DEP-01 RC pin outside catalog | FIX with PN-DEP-01; check examples against node_modules | QUALITY | QUEUED |
| ZD-ARC-01 deprecated string-method forms | FIX (codemod, 19 uses) | QUALITY | QUEUED |
| TS-BLD-01 `isolatedModules` | DECIDED: add `isolatedModules` if tsc stays green; `verbatimModuleSyntax` not now (repo-wide churn) | QUALITY | QUEUED |
| TS-DEV-01 strictness | DECIDED: no action (stricter than default) | GOV | QUEUED |
| RE-PER-02 `key={index}` x5 | FIX or justify each | QUALITY | QUEUED |
| RE-SEC-01 caveat: Mermaid strictness is the library's claim | DECIDED: accept; docs not captured | GOV | QUEUED |
| AN-ARC-02 structured outputs for the direct adapter | DECIDED: keep prompt-and-parse (provider-neutral gateway, ADR-0007, rule 1); reason recorded | GOV | QUEUED |
| AN-DEP-01 model defaults lag | FIX: sonnet-5-5 and opus-5-5 defaults in config, startup warning on unknown ids | QUALITY | QUEUED |
| AN-ERR-01 headless `default` permission mode | VERIFY: confirm no profile uses it; guard test | VERIFY | QUEUED |
| AN-DEP-02 two SDK copies | DECIDED: note only | GOV | QUEUED |
| SW-ARC-02 `@unchecked Sendable` without invariants | FIX: a written invariant and removal plan at each of the 10 sites | SWIFT | QUEUED |
| SW-SEC-01 WKWebView navigation allow-list unverified | FIX: a Swift test pinning the allow-list and the media-capture rule; Apple docs capture not needed | SWIFT | QUEUED |
| SW-ARC-01, SW-TST-01 documented deviations | DECIDED: accept (Command Line Tools limits), already documented | GOV | QUEUED |
| SW-SEC-02 ad-hoc signing resets TCC | DECIDED: accept (dev bundle) | GOV | QUEUED |
| TE-ARC-02 `corePath` directory contents | VERIFY against the installed 7.0.0 README | VERIFY | QUEUED |
| Cross-cutting 1: ADR-0004..0007 still Proposed | FIX: check each against the code, then accept | GOV | QUEUED |
| Cross-cutting 8: stale invariant records | FIX: rerun the guards, refresh `reconciliation.yml` | GOV | QUEUED |
| Cross-cutting 10 / Q10: docs not captured; OAuth PKCE absent | PKCE: FIX; docs capture: DECIDED backlog (`refresh-research-sources`) | SEC + GOV | QUEUED |
| Lead review: AU-SEC-02 deeper, HO-SEC-02 spoofable headers | covered by the rows above | WEB, SEC | see above |

## B. Final report open items (section 6)
| # | Item | Decision | Pkg | Status |
| --- | --- | --- | --- | --- |
| 1 | F-OWNER misleading web message | FIX: "The Interview Studio app owns capture", web Capture disabled with the reason; the expected-failure spec becomes a passing spec | PRODUCT | QUEUED |
| 2 | toolbar capture vs answer-pane staging | DECIDED: NO CHANGE. The toolbar's behaviour is locked by the owner; the two flows have different intents (new problem vs add to tray). Recorded in an ADR | GOV | QUEUED |
| 3 | rare stale "Drafting" marker | FIX what can be: deterministic tests for the `mergeActions` tie candidate; close as unreproduced after | PRODUCT | QUEUED |
| 4 | web declined share is a plain alert (F8); 28 pending claims | FIX F8; convert every claim that can be proven without a real provider; the rest stay pending with a stated reason | PRODUCT | QUEUED |
| 5 | scanners ignore `.gitignore` (OCR drift) | FIX locally: `scripts/docs-arch.mjs` moves `apps/web/public/ocr` aside during derive and check; upstream request already drafted | TOOLING | QUEUED |
| 6 | ADRs for D28-D38 | FIX: write the six ADRs (revision model, OCR, screenshots-to-model privacy, no-question captures, region pass-through, arch extractor override), Proposed | GOV | QUEUED |
| 7 | exporting `CRUX_ARCH_ALLOW_OVERRIDES` | DECIDED: scripts and per-command only, never exported; documented in the README and `.env.example` | n/a | DONE |
| 8 | Objectives OBJ-7..10 review | OWNER: marking `reviewed_at` is an attestation of the owner's own review; not decided by the lead | owner | OWNER |
| 9 | skills: forge-log entries; `bionic-regeneration` scope | FIX: write truthful `used` and `evaluated` entries; scope DECIDED: keep | GOV | QUEUED |
| 10 | other-repo processes untouched | DECIDED: informational, closed | n/a | DONE |
| 11a | model defaults lag | see AN-DEP-01 | QUALITY | QUEUED |
| 11b | ADR-0023 acceptance, rule 5 / INV-0002 wording | FIX: accept and apply the wording list from `drizzle-audit.md` | GOV | QUEUED |
| 11c | G8 complexity field | DECIDED: NOT NOW (adds schema and prompt surface that cannot be validated without a live model); revisit after live testing | GOV | QUEUED |
| 11d | L-1 guards withhold recovery drafts | FIX: scope the availability-wording rule away from coding tasks; tests plus the replay sets | PRODUCT | QUEUED |
| 12 | native app reinstall | after NATIVE reports: rebuild, reinstall, restart the :3100 stack from master | lead | QUEUED |
| 13 | boot check: what `next start` does on a throwing `register` | VERIFY by experiment | VERIFY | QUEUED |
| 14 | mic guard, triggering spec not bisected | DECIDED: closed; fix verified by the owner | n/a | DONE |
| 7-s | section 7: real-app items (SCK, hotkeys, geometry, real mic, live-model wording) | OWNER: manual matrix M1-M39; not automatable here | owner | OWNER |

## C. Independent review (security, native, web), 2026-10-05
Three read-only reviewers found 5 blockers, 17 should-fix items and about 28 notes. The reviewers had no write tool, so the findings live here.

### Fixed in this change
| Finding | Fix | Evidence |
| --- | --- | --- |
| SEC B1: the runtime database role could plant a SECURITY DEFINER function that the next `ensure-roles.sql` run handed to the owner | The handover runs only while the runtime still owns the database; `search_path` pinned | `role-split.test.ts` "never hands the owner a schema or function the runtime role creates" (fails before, passes after) |
| NATIVE B1: sign-in could be stolen with the state (history/clipboard) and the code (URL scheme) | PKCE S256: the shell keeps a verifier, sends only the challenge; redeem needs the verifier | `native-handoff.test.ts`, `native-auth.test.ts`, `NativeSignInTests.swift` incl. the RFC 7636 vector |
| NATIVE B2: clear glass made the start and sign-in screens unclickable and See-through locked | `.pn-start-card` and `.pn-start-toast` are hit regions; See-through is never locked | `hit-regions.test.tsx`, `start-panel.test.tsx` |
| NATIVE S1: crash on a cold launch from the URL scheme | `signIn?.` instead of a force-unwrap | build |
| WEB B1, B2: a global gitignore hid `.github/` and the vendored tarball, so CI and a fresh install could not work | `!/.github/`, `!/vendor/**/*.tgz` in `.gitignore` | `git status` lists both as untracked |
| SEC S1: personal data (`apps/web/.data`) copied into the Docker image | `**/.data` and `.claude/settings.local.json` in `.dockerignore` | file |
| Docker worker had no Claude Code and the session loop required LM Studio | Gateway serves the agent runner alone; the worker runs on the host | `session-gateway.test.ts`, real-provider check `BANANA 42` |

### Deferred (not release blockers; owner to schedule)
| Finding | Note |
| --- | --- |
| SEC S2 committed default secrets bypass the AU-SEC-01 refusal | treat known committed values as absent unless fake auth is on |
| SEC S3 `AUTH_ASSUME_LOOPBACK_CLIENTS` trusts every container | pin the bridge gateway with compose `ipam` and trust that address only |
| SEC S4 dev bypass ignores the Host header (DNS rebinding) | apply `isLoopbackHost` to the bypass branch |
| SEC S5 `/api/v1` lets any member of any tenant write shared data | require `interview.write` on mutating methods |
| NATIVE S2 any frame can press the fallback screen's buttons | honour only in the main frame on the fallback page |
| NATIVE S3 in-window "Sign in" does nothing | load `signInPanelURL` for a user-started main-frame navigation |
| NATIVE S4 any scheme URL ends the waiting attempt | ignore callbacks that do not parse |
| NATIVE S5 first run: Start blocked by Screen Recording | ask once, or block Start only on the microphone |
| NATIVE S6 / WEB S2 Capture disabled in other app windows | revert or name the case it protects; re-request the owner lock |
| NATIVE S7 untargeted session after an ended one | owner decision: does it count as an interview? |
| NATIVE S8 "You're signed in" shown before the app redeems | reword to "Return to Interview Studio to finish signing in" |
| WEB S1 availability rule skipped when the model's own `codingBrief` says coding | decide "coding" from the captured exercise only; add the test |
| WEB S3 welcome banner shows for any `signed-in` value | allow only google, linkedin, local |
| WEB S4 OCR aside folder left behind on SIGHUP | handle SIGHUP; ignore is added to `.gitignore` |
| Notes N1-N7 (security), N1-N10 (native), 11 (web) | see the three reports in the session transcript |
