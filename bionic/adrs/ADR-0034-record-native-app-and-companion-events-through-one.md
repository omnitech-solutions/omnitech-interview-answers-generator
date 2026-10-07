---
id: ADR-0034
title: "Record native-app and companion events through one redacting event log"
status: Proposed
date: 2026-10-07
proposed_date: 2026-10-07
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0007]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [observability, native, logging, active-session]
related_briefs: []
related_research: []
governs: []
---

# ADR-0034 — Record native-app and companion events through one redacting event log

## Context

A live session paused itself a few seconds after every start or resume and nothing said why. The
trace that found the cause (a silence-ended speech request treated as a lost source, and a lost
source outranking a running one) had to be built by hand: the native shell logged nothing, the
capture companion was designed to log nothing, and the server saw only a heartbeat flag. ADR-0007
(rule 8) forbids logging content by default and stays in force; it says nothing about the operational
events around that content, and their absence made a visible defect undiagnosable. The owner asked for
one transparent layer with one entry point that tells a person's action apart from a heartbeat or
Studio's control, records every interaction the native app can have, and never carries credentials
or content; and for the same discipline on the server, including AI interactions when a trace is on.

## Decision

- The native app records every event through one entry point, `StudioShellCore.EventLog`
  (`apps/studio-shell/Sources/StudioShellCore/EventLog.swift`). An event is an origin (`user`, `page`,
  `heartbeat`, `server`, `system`), a short name and string fields that are codes and ids. Redaction is
  part of the entry point and cannot be turned off: a key naming a credential or content is dropped,
  a value that is not a code is replaced.
- The capture companion stays silent on its own; it exposes exactly one hook
  (`CaptureCore.CompanionEvents`) that the host installs into the same log. Sources lost, runs ended,
  acknowledgements read and heartbeats sent are events.
- The companion's heartbeat carries its state as codes (`diagnostics` in `heartbeatSchema`,
  `packages/active-session-contracts`), optional so older companions still validate. Studio logs it
  with every pause it causes, so a self-pause always has a stated reason.
- Server code logs through one package, `@omnitech/logging`: an event name plus fields, levels,
  format and content permission from the environment (`LOG_LEVEL`, `LOG_FORMAT`, `LOG_CONTENT`),
  redaction built in. The AI gateway reports every call (profile, target, duration, outcome); prompts
  and output are written only at level `trace` with `LOG_CONTENT=true`, which keeps ADR-0007's default.
- Configuration, never code, decides how loud a run is: `STUDIO_LOG_LEVEL` and `STUDIO_EVENT_LOG*`
  for the app (unified log and a rotating JSON-lines file under the user's Logs folder), `LOG_*` for
  services. Defaults are quiet about content in every environment.
- A lost capture source stops only itself. The session keeps capturing while any selected source runs;
  a revoked permission, a failed capability, Studio's pause and terminal states still stop everything.

## Alternatives Considered

### Option A — Ad-hoc `print`/`console` lines where a bug is being chased
- **Pros:** zero design.
- **Cons:** no origin, no redaction, stripped from production builds, removed after each hunt.
- **Why not:** this is what was missing; the hunt would start from nothing next time.

### Option B — A third-party logging stack (pino + OpenTelemetry) on the server and os_log only in Swift
- **Pros:** rich tooling, standard GenAI attributes.
- **Cons:** new dependencies and infrastructure for a single-tenant local product (ADR-0002); os_log
  alone gives the companion no file a bug report can attach and no redaction seam.
- **Why not:** simplicity first; the chosen layer is small, dependency-free and can grow a sink later.

## Consequences

**Positive:**
- A self-pause, a lost source, a refused acknowledgement and every menu or page command are on record
  with their origin, in dev and in production, without a rebuild.
- One redaction seam per side; ADR-0007's rule 8 is kept by construction, not by care.

**Negative:**
- The wire gains an optional field; the Swift and TypeScript schemas must move together.
- Two more environment surfaces to document (`.env.example`, `apps/studio-shell/README.md`).

**Follow-on work:**
- A diagnostics report in the app (the log's ring buffer) that a person can copy into a bug report.
- The web pages' own interactions (the panel toolbar, the footer) recorded through the host bridge.
- Retire the baselined SwiftLint findings in `BridgeHandler` and `AppDelegate` by splitting them.

## References

- [[adrs/ADR-0007-ai-execution-gateway-and-agent-worker]] (rule 8: never log content by default)
- [[adrs/ADR-0002-simplicity-first]]
- `bionic/inbox/redesign/native-qa-todo.md` (issue 010: the trace and the fixes)
- `apps/studio-shell/README.md`, `packages/logging/README.md`
