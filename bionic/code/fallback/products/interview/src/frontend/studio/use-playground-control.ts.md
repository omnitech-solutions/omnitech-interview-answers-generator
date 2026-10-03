# products/interview/src/frontend/studio/use-playground-control.ts

_Source: `products/interview/src/frontend/studio/use-playground-control.ts` (header-comment fallback)_

Follows the Playground control channel while the studio is visible and
applies each new push once. The channel is optional: when it is missing
or failing, the studio carries on and the next poll retries.
