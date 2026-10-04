# Changelog

## [Unreleased]

- Added Active Session capture, worker processing, and Studio controls for interview rehearsal.
- Session deletion keeps edited or revision-linked Workspace drafts that may contain captured content.[^retention]
- Active Session can answer from a screenshot or typed follow-up, runs short answers and code in separate slots, and shows them in one draggable overlay card that maximizes, floats in a Picture-in-Picture window over any tab, and moves across sessions.[^runtime] Agent-backed assistance (Claude or Codex, with image input) ships disabled until `ACTIVE_SESSION_AGENT_PORT=on`.
- Interview Studio's live overlay installs as a web app from the browser and runs in a native macOS shell (`apps/studio-shell`) that offers "This Mac (native)" capture through one host adapter; the window states that it is visible in screen shares.[^shell]
- Structured logistics answers use approved preferences. The UI flags fields
  with no matching approved preference line. Suggested drafts do not set preferences.

[^retention]: [[adrs/ADR-0013-pause-rather-than-end-an-active-session-on-credent]]
[^runtime]: [[adrs/ADR-0016-run-active-session-assistance-on-the-worker-executor]], [[adrs/ADR-0017-host-the-active-session-overlay-as-one-route-and-isolate-providers]]
[^shell]: [[adrs/ADR-0019-host-the-overlay-in-a-native-shell-through-one-host-adapter]]
