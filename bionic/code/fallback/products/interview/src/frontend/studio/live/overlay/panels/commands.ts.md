# products/interview/src/frontend/studio/live/overlay/panels/commands.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/commands.ts` (header-comment fallback)_

The typed command set every page understands, however it is issued: by the
in-page keymap, or by a hotkey the host registered system-wide. Pure: this
file maps keys to commands and claims one run per physical press; the
controller (use-panel-session) says what each command does.
