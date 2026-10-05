# products/interview/src/frontend/studio/live/shared/use-screenshot-send.ts

_Source: `products/interview/src/frontend/studio/live/shared/use-screenshot-send.ts` (header-comment fallback)_

The "Screenshots to the model" setting of the open session as the UI needs
it: the SAVED value from `session.screenshotSend`, why it cannot change, and
the save (one POST per change). Both live surfaces call it; the server's
record is the only truth, so a refused save leaves the saved value showing.
