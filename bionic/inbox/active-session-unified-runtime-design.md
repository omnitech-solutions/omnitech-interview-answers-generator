# Active Session: unified runtime and screen assistance (input design)

Status: proposed design from the user; input to PB-0004, not acceptance evidence.
Dependency: PB-0003 (ADR-0014/0015 agent runtime reliability) owns the shared
agent executor and Codex/Claude adapters; reuse its public boundary, never replace it.

## Decisions (final, do not re-litigate)
- Extend the existing Active Session processor (`createSessionProcessor()`, `beginDispatch()`).
  No OpenCluely service, second coordinator, second job queue, or second conversation store.
- Share execution machinery, not workflows or conversation histories. Worker-local
  `AgentExecutionPort` calls the same shared executor the agent-job worker uses; bounded,
  tool-less structured inference only on the session fast path (narrow amendment to the
  no-agent composition: no tools, Next.js never launches agents).
- Codex: long-lived App Server host behind the existing adapter. Claude: TypeScript Agent SDK
  `query()` with AsyncIterable streaming input behind the existing adapter. Do not use
  `unstable_v2_createSession` or assume a `ClaudeSDKClient` class in TypeScript.
- Provider handles are disposable; fresh context per independent structured action; wait for
  terminal cancellation before reuse; typed failure on host crash; no unbounded replay in adapters.
- Pin the selected execution profile/version at session start, independent of the experience-matrix
  revision. One provider for answer and code; no racing or cross-provider fallback.
- Screenshots go straight to a vision-capable profile in the existing assist call (no OCR chain).
  Carry attachments via the existing `AgentAttachment` shape; extend `DispatchPrompt`; resolve
  through an owner/session-scoped loader (validate association, media type, size, dimensions;
  no arbitrary paths/URLs). Capability must prove image input reaches the provider; unsupported
  vision or device-only with remote runtime = explicit refusal.
- Explicit **Analyze latest capture** (freeze the snapshot reference at acceptance) plus typed
  follow-up: one product-owned owner-input type (request ID, operation, target task/revision,
  optional text, exact screenshot refs) stored in existing session input storage with dedup.
  New internal observation kind (DB CHECK + replay/claim logic), NOT in the capture-credential
  allowlist. Extend task-revision provenance to reference speech, snapshots, owner input.
  Screen content is untrusted evidence. No capture wire change in v1.
- Two action slots (short assist, coding/verification) replacing the single `inflight`/`openActionId`;
  superseded work is cancelled, fenced publication remains the correctness boundary. Shared
  worker admission, live work preferred (background admitted to C-1 while a session is open).
  Keep `draft-answer` and `solve-code` stages; publish only validated final structured results.
- One UI/store: compose existing Live components into Full / Focus / Floating presentations.
  Document Picture-in-Picture with in-tab Focus fallback, React portal under the Studio shell,
  copy styles into the PiP document, extend the existing visibility dependency (no second poll
  loop); closing the float never pauses/ends/purges. Pinning an older task is presentation only.
  No concealment, process disguise, auto-typing, or screen-share evasion.
- Safety unchanged: processor owns preference invariant, pinned evidence, latest-revision
  publication; recheck standing after capacity wait and before dispatch; no DB transaction over
  inference; purge clears inputs, staged images, handles, provider-local transcripts; retention
  runs with no model configured; never log captured content.
- Coding languages stay TypeScript/React via the existing language/runner registry.

## Delivery slices
1. Shared executor + profiles into transcript-based Active Session (both providers; keep direct-model).
2. Selected-screenshot input through the same assist/code path.
3. Two action slots + shared admission policy.
4. Focus/Floating presentation (UI can proceed against fixtures).

## Acceptance scenarios
Spoken question on Claude and Codex (same schema/validation/cancel/publish); screenshot-only coding
problem; spoken correction during code generation; document generation during a session; duplicate
input/replay after restart; narration before structured result; unsupported vision / device-only
with remote runtime; pause/permission loss/end/purge/shutdown; float view with Studio hidden;
owner edits Workspace while code runs (conflict, no overwrite). Record queue wait, first validated
answer, code-ready time, total time, attempts, stale-result suppression without logging content.
UI reference mockup: ~/Downloads/Live Overlay.html (Focus/floating overlay).
