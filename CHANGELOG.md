# Changelog

## [Unreleased]

- Added Active Session capture, worker processing, and Studio controls for interview rehearsal.
- Session deletion keeps edited or revision-linked Workspace drafts that may contain captured content.[^retention]
- Active Session can answer from a screenshot or typed follow-up and runs short answers and code in separate slots. A Focus view and a floating Picture-in-Picture view show the same session.[^runtime] Agent-backed assistance ships disabled until `ACTIVE_SESSION_AGENT_PORT=on`.
- Structured logistics answers use approved preferences. The UI flags fields
  with no matching approved preference line. Suggested drafts do not set preferences.

[^retention]: [[adrs/ADR-0013-pause-rather-than-end-an-active-session-on-credent]]
[^runtime]: [[adrs/ADR-0016-run-active-session-assistance-on-the-worker-executor]]
