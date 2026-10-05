# products/interview/src/frontend/studio/live/use-capture-problem.ts

_Source: `products/interview/src/frontend/studio/live/use-capture-problem.ts` (header-comment fallback)_

The one piece of state for "why the last capture did not work": set by every
path that can fail a capture, cleared when the next capture succeeds or the
person dismisses it. A surface draws it with CaptureProblemBanner and shows
a toast where it has one; nothing is ever dropped silently.
