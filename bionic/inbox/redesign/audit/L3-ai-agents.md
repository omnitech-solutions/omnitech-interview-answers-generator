# L3 audit: AI gateway, agents, execution

## 1. Scope and method

Read in full or in the relevant parts: `packages/ai-contracts`, `ai-runtime` (index.ts, config.ts), `ai-provider-anthropic`, `ai-provider-openai` (grep for timeouts/retries), `ai-provider-images` (via its wiring), `agent-runtime-contracts`, `agent-runtime-claude`, `agent-runtime-codex`, `agent-job-service` (grep), `code-runner/src/index.ts`, `apps/agent-worker` (main.ts, index.ts, session-gateway.ts, session-agent-port.ts), `apps/terminal-gateway/src/index.ts`, `apps/web/src/platform/ai.ts`, gateway call sites in `products/*/src/backend`. Used the `ai-provider-maintainer` skill and the `claude-api` skill (model ids, timeouts/retries, streaming, usage, stop reasons).

Commands run (read-only `git grep`):
- INV-0005 check (`git grep -n -E "agent-runtime-(claude|codex)|child_process" -- apps/web`): NOT clean. It matches `apps/web/next.config.ts:1,9` (`execSync("git rev-parse")`, build id only, hard-coded commands, no user input) and three test files (`route.test.ts:2`, `session-ingest.test.ts:6`, `pages.test.tsx:2`). No agent runtime import in `apps/web`. The check's "no output" pass criterion is stale.
- INV-0006 check: 4 matches, all in frontend: `documents/assistant-model.ts:6`, `live/shared/task-card-model.ts:187,194,309` (see ai-07).
- Spawn sweep over all `*.ts` outside tests: only `agent-runtime-codex` (spawn), `code-runner` (spawn/execFile docker), `next.config.ts`, `packages/database/src/test-support/postgres.ts` (test support), and script files. `terminal-gateway` spawns nothing (it only polls job events over HTTP).

Not inspected: ai-provider-images internals (only its call in ai.ts), `agent-job-service`/`platform-storage` internals beyond `AgentPayloadStore` location, `session-e2e-support.ts`, `strict-schema.ts`, `package-boundaries-hold` check (not run), Knip/jscpd (not run for this slice), `dist/` contents. `apps/web/src/platform/agent-models.ts` only grepped.

## 2. Findings

| ID | Sev | Evidence | Rule | Fix | Lines | Risk | ADR |
|---|---|---|---|---|---|---|---|
| ai-01 | HIGH (inferred active bug) | `apps/agent-worker/src/index.ts:172` passes `timeoutMs` into the request, but neither runtime reads it: `agent-runtime-claude/src/index.ts:198` and `agent-runtime-codex/src/index.ts:161` only copy it on resume, and `grep timeoutMs` finds no timer in the job path. Only `session-agent-port.ts:556` enforces `agent.timeoutMs`. A stuck document job runs forever, renewing its lease. | ADR-0007 "bounded" profiles | Race the event loop in `runAgentWorker` against `setTimeout(job.profile.timeoutMs)` and call `runtime.cancel`, as `session-agent-port` does (extract that helper) | 40 | med | n |
| ai-02 | HIGH | `apps/terminal-gateway/src/index.ts:34-37,44`: `token` is optional, so unset means no auth. The token travels in the query string (AGENTS privacy: no secrets in URLs). It is compared with `!==` (not constant time). There is no `Origin` check, so any local web page can open the socket (cross-site WebSocket hijack) when the token is unset. `tenant` and `session` come from the client, and the gateway reads events with a service token, so a token holder can read any tenant's job events. Raw `error.message` is forwarded to the client (line ~96). | ADR-0005 tenant isolation, AGENTS rule 8 | Refuse to start without a token; check Origin; send the token in the first message or a subprotocol; verify the observer's tenant membership through the platform before polling; send a fixed error text | 60 | med | n |
| ai-03 | MEDIUM | `apps/web/src/platform/ai.ts:~562,~608` `authorize`: `presentation.read \|\| interview.read` grants every profile, including the presentation `agent-job` profile and Claude/Codex agent profiles, to any reader of either product. | ADR-0004 product verticals | Per-profile required permission on `AiProfile`, checked in `authorize` | 30 | low | n |
| ai-04 | MEDIUM | `products/presentation/src/backend/api.ts:43,590` takes a user-supplied free-text `modelId` (max 200 chars, no pattern) into `ai.image.modelId`. `ai.ts` interpolates it into `https://fal.run/${modelId}` and into the Together/OpenAI request bodies. Result: user-chosen model (cost and policy bypass) and `../` path control on a host that receives the FAL key. | security-review (path injection), ADR-0007 profile-bounded | Make `modelId` an enum from the profile's catalog (or drop it) and ignore `request.task.image.modelId` in the adapters | 25 | low | n |
| ai-05 | MEDIUM | `ai.ts:~420-480`: ComfyUI `JSON.stringify(workflow).replaceAll("{{prompt}}", request.task.prompt)` puts the raw prompt inside a JSON string. A prompt containing `"` or `\` breaks the workflow or injects nodes. | injection | Substitute into the parsed object (walk string values), not the serialized text | 15 | low | n |
| ai-06 | MEDIUM | Provider logic lives in the web host, not `ai-provider-images`: about 190 lines of inline `fetch` for FAL, ComfyUI, Together and OpenAI Images in `apps/web/src/platform/ai.ts:~303-500` (file is 620 lines). It also reads `FAL_*`, `COMFYUI_*`, `TOGETHER_*`, `OPENAI_IMAGE_MODEL`, `OPENAI_BASE_URL` and `ANTHROPIC_*` directly. | ai-provider-maintainer ("transports stay private to the provider package", "model endpoints configured once in ai-runtime/src/config.ts") | Move each transport into `ai-provider-images`, resolve env in `ai-runtime/config.ts` (same shape as `resolveLanguageModels`); `ai.ts` keeps wiring only | 250 moved | med | n |
| ai-07 | MEDIUM | Frontend branches on provider identity. `documents/assistant-model.ts:6,35` hard-codes `"agent/claude-code"` as the preferred document target. `task-card-model.ts:186-188` maps runtime names to display labels. INV-0006 matches and has no allow-list. | INV-0006 (products never branch on provider names) | Let the host mark one target `preferred: true` in the listing, and have the backend return `generatedBy.label`; delete both strings | 40 | low | n |
| ai-08 | MEDIUM | `ai-provider-anthropic/src/index.ts`: `stream()` (line 82+) does not pass `request.signal` (no cancellation), emits no usage and ignores `stop_reason` (including `refusal`). There is no timeout or `maxRetries` set, so the SDK default of 10 min x 3 attempts is far over `AI_TIMEOUT_MS=120s` used by the OpenAI adapter. `max_tokens` is fixed at 4096 and never read from config. No `streamStructured`. The retry-on-invalid-JSON path is duplicated in `ai-provider-openai/src/structured-output.ts`. | ai-provider-maintainer ("cancellation, bounded timeouts"), claude-api (streaming, timeouts) | Pass `{signal, timeout}`; use `stream.finalMessage()` for usage; map `refusal` to a typed failure; share the structured repair loop in `ai-contracts` | 60 | low | n |
| ai-09 | MEDIUM | Model defaults disagree and are scattered: `ai.ts:293` `claude-sonnet-4-6`; `config.ts:191` `claude-opus-4-6`; `config.ts:259` alias `"sonnet"`; `gpt-5-mini` (`config.ts:96`) and `gpt-5.3-codex` (`:198,210,277`); `gpt-6-luna` (benchmark scripts). `claude-sonnet-4-6` and `claude-opus-4-6` are valid but a generation behind (current: `claude-sonnet-5-5`, `claude-opus-5-5`; claude-api skill table dated 2026-09-25). | single source of truth | One `DEFAULT_MODELS` table in `ai-runtime/config.ts`; decide on versions deliberately | 30 | low | n |
| ai-10 | MEDIUM | Timeouts and limits are scattered: `120_000` in `config.ts:70,202`, `openai/index.ts:56,65`, `chat-completions.ts:55`; `300_000` x5 in `config.ts`; `600_000` in `ai.ts` for LM Studio; `maxRetries: 0` (`openai/index.ts:57`) vs `2` (`chat-completions.ts:64`); `MAX_IDLE_MS`/`MAX_SESSIONS` inside the Claude runtime; `AGENT_IMAGE_MAX_BYTES` is in contracts (good). | duplication | Export `DEFAULT_TIMEOUT_MS`/retry policy from `ai-contracts` and use it in all adapters | 30 | low | n |
| ai-11 | MEDIUM | `AGENT_PAYLOAD_SECRET ?? CONNECTED_ACCOUNT_SECRET` is repeated in `agent-worker/main.ts:231,356`, `web/platform/agent-api.ts:48`, `ai.ts:50`. This silently reuses the connected-account token key as the prompt-payload key. | ADR-0006 (separate secrets) | Single `payloadSecret(env)` in `platform-storage`; remove the fallback or log a startup warning | 20 | low | n |
| ai-12 | MEDIUM | `code-runner/src/index.ts:317-339`: sandbox is good (see section 6) but has no `--user` (container runs as image default, probably root, and `out/` is chmod 0777 at line 313), no `--ulimit nofile/fsize`, and the memory limit has no `--memory-swap`. The docker binary is called with an inherited env. | defence in depth | Add `--user 65534:65534`, `--memory-swap` equal to memory, `--ulimit fsize` | 8 | low | n |
| ai-13 | MEDIUM | Parallel wiring of the gateway: `apps/web/ai.ts` and `agent-worker/session-gateway.ts` each build adapters, profile lists and `authorize` separately from `resolveDefaultLanguageModel`. Web has the OpenAI adapter on the same config but also an Anthropic path with `document-quality`, so a document is generated by either Claude Code (agent job) or the Messages API depending on whether `ANTHROPIC_API_KEY` is set (`ai.ts:516`). | simplicity (ADR-0002) | Decide one path for "High quality"; if the Messages API is kept, give it a profile name that does not collide with `document-quality` | 30 | med | y (small) |
| ai-14 | MEDIUM | Worker job path vs session path differ: job requests are not `toolless` and the environment is the adapter allow-list, but `session-agent-port` builds its own env and staging (`providerEnvironment`, private `CODEX_HOME`). Claude keeps the worker's real HOME (`session-agent-port.ts:355`). The two share no abstraction for run limits (timeout, output bytes: enforced only in the session path, `:556,:588`). | consistency with ai-01 | Extract a `boundedRun(runtime, request)` used by both | 60 | med | n |
| ai-15 | LOW | `agent-runtime-claude/src/index.ts:386-389`: `AbortController` is created but only `interrupt()`/`close()` are used for cancel; `request.timeoutMs` never read. Codex `close()` sends no timeout. Codex spawn env falls back to full `process.env` when `options.environment` is unset (`codex/index.ts:55`); only the worker supplies an allow-list. | least privilege | Default to an empty allow-list; abort the controller on cancel | 10 | low | n |
| ai-16 | LOW | `terminal-gateway/dist` and other `dist/` d.ts still reference deleted modules (`answer-runner`, `concept-runner`, `node-pty-helper`), so `dist/` is stale; `agent-runtime-*/scripts/*.ts` benchmarks read model env. | dead code | Confirm `dist` is gitignored; keep scripts out of Knip entries | 0 | low | n |
| ai-17 | LOW | `AGENTS.md`/ai-provider-maintainer say one config file, but `ai-runtime/src/config.ts` also reads `~/.codex/config.toml` (`:154-164`) at profile resolution (I/O in config). | inconsistency | Document, or move to the worker | 5 | low | n |

## 3. Duplication map

| Cluster | Locations | Owner |
|---|---|---|
| Timeout/retry defaults | config.ts, openai/index.ts, chat-completions.ts, ai.ts (600k), anthropic (none) | `ai-contracts` constants |
| Payload secret fallback | main.ts x2, agent-api.ts, ai.ts | `platform-storage` helper |
| Per-run limits (timeout, output bytes) | session-agent-port.ts only; missing in job path | one `boundedRun` in agent-worker |
| Structured-output repair retry | anthropic/index.ts, openai/structured-output.ts | `ai-contracts` |
| Image transports | ai.ts (4 inline fetchers) | `ai-provider-images` |
| Model/provider name defaults | ai.ts, config.ts, scripts | `ai-runtime/config.ts` |
| Runtime label mapping | agent-models.ts:20, task-card-model.ts:187 | host listing/backend |
| Env allow-list | main.ts `agentEnvironment` vs session-agent-port `providerEnvironment` | one function in agent-worker |

## 4. Missing mechanical guards

- Profile timeout is enforced for every job: test in `apps/agent-worker/src/index.test.ts` with a runtime that never finishes (fake timers) and expect `failed`/`cancelled` (fails today).
- INV-0005 check: allow-list test files and `next.config.ts`, or add `:!*.test.*` and an exact `next.config.ts` exception; it fails as written.
- INV-0006: add an allow-list file or an AST check; the grep reports 4 reviewed matches with no record.
- No raw `fetch` to a model/image endpoint outside `ai-provider-*`: ast-grep rule in `scripts/` (name `provider-calls-stay-in-provider-packages`).
- Process spawn only in `agent-runtime-codex`, `code-runner`: extend INV-0005 to the whole repo minus tests/scripts.
- Terminal-gateway: test that it refuses to start without a token and rejects foreign `Origin`.
- Code-runner: a test asserting the docker argument list contains `--network none`, `--cap-drop ALL`, `--read-only`, `--user`.
- Logging (AGENTS rule 8): no guard. Only `console.error` in `agent-worker/main.ts:153-158` (logs loop name and a sanitised error name) and a startup `console.log` in terminal-gateway were found; add a grep invariant `no-console-in-ai-and-agent-packages`.

## 5. Work packages (ordered)

1. WP-A `apps/agent-worker` (ai-01, ai-14, ai-15, ai-11 worker half): shared `boundedRun`, job timeout, env allow-list unification. Tests: new timeout test, existing `loops.test.ts` and `session-agent-port.test.ts` unchanged. No dependency on other layers.
2. WP-B `apps/terminal-gateway` (ai-02, ai-16). Independent; needs the platform events route to verify tenant membership (L-platform layer).
3. WP-C `packages/ai-provider-anthropic` + `ai-contracts` constants (ai-08, ai-10, ai-09). Tests: stub client in `messages-api.test.ts` (signal, timeout, refusal, usage).
4. WP-D image providers (ai-04, ai-05, ai-06): move transports and env into `ai-provider-images` and `ai-runtime/config.ts`; `ai.ts` shrinks to wiring. Needs presentation product (`api.ts:43`) schema change. Tests: stub `fetch`, JSON-quote prompt test, modelId allow-list test.
5. WP-E authorization per profile (ai-03) in `ai-runtime` + `ai.ts`; affects both products' backends.
6. WP-F frontend provider strings (ai-07): small change in `products/interview` frontend and backend `generatedBy`; coordinate with T08 who edits `task-card-model.ts` (do after T08 lands).
7. WP-G code-runner flags (ai-12); `sandbox.test.ts` extension.
8. WP-H invariant checks (section 4).

## 6. Already good (do not disturb)

- `AiExecutionGateway`: two policy checks (device-only), catalog allow-list, attachments only to agent profiles, tenant authorize before dispatch (`ai-runtime/src/index.ts`).
- Agent profiles are typed and versioned and refuse additionalDirectories and non-read-only + no-approval (`validateAgentProfile`); Claude runtime sets `strictMcpConfig`, empty `mcpServers`/`plugins`, `settingSources: []`, tool-less requests expose no tools and fail typed on any tool start; Codex disables shell/browser/computer features and denies interactive requests.
- Worker env allow-list per runtime (`agentEnvironment`); per-attempt private dirs mode 0700; images read with `O_NOFOLLOW` and byte bound.
- Code-runner: `--network none`, `--cap-drop ALL`, `no-new-privileges`, `--read-only`, tmpfs `noexec`, memory/cpu/pids limits, `--pull=never`, unique container name with `kill`/`rm -f` on timeout, output cap, bounded cleanup, only `out/` writable; docker args are an array (no shell), source file mounted read-only.
- Safe failure messages: names model and failure kind, never provider text (openai `failureKind`); closed failure-reason vocabulary; no prompt/response logging found in this slice.
- Only provider packages import `openai` and `@anthropic-ai/sdk`; Claude Agent SDK only in `agent-runtime-claude`; `apps/web` imports no runtime adapter.
