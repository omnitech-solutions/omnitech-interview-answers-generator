# products/interview/src/frontend/studio/live/shared/shortcuts.ts

_Source: `products/interview/src/frontend/studio/live/shared/shortcuts.ts` (header-comment fallback)_

Every shortcut the app really binds, in one table for the keys popover and
the web hints. Native chords are registered by the Mac shell (Hotkeys.swift,
which stays its own table); shortcuts.test.ts reads that file and fails when
the two disagree. The web's own Alt bindings come from COMMAND_KEYS, the
table the page's key handler already matches against.
