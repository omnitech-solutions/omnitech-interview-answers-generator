# packages/active-session-contracts/src/screenshot.ts

_Source: `packages/active-session-contracts/src/screenshot.ts` (header-comment fallback)_

Screenshots are accepted by leading bytes, never by a declared type or file
name. SVG, HTML, scripts and everything else are refused (returns null).
