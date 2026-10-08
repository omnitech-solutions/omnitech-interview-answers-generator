# products/interview/src/frontend/studio/live/overlay/panels/use-call-audio.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/use-call-audio.ts` (header-comment fallback)_

How this Mac captures the other side of the call (screen capture, or the
system audio tap), read from the shell and changed through it. The shell
owns the choice; a browser or an older shell has no such bridge member and
this is null. Read again whenever `refresh` changes (a menu opening).
