# packages/active-session-contracts/src/control.ts

_Source: `packages/active-session-contracts/src/control.ts` (header-comment fallback)_

A one-shot "capture now" request from Studio (ADR-0016 follow-up). It names
what to capture and nothing else: no source, identity, hint or target. The
companion honours it only for a screen source the user selected at start.
