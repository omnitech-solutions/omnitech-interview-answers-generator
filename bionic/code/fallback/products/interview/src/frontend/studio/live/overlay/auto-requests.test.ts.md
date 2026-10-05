# products/interview/src/frontend/studio/live/overlay/auto-requests.test.ts

_Source: `products/interview/src/frontend/studio/live/overlay/auto-requests.test.ts` (header-comment fallback)_

The real request builders of Auto's two posts (a capture and a heard phrase),
run through the SAME zod schemas the server parses them with, so an
invalid_input from a shape mismatch is caught here, not in the installed app.
