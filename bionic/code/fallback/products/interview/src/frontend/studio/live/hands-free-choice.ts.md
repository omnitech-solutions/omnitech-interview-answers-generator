# products/interview/src/frontend/studio/live/hands-free-choice.ts

_Source: `products/interview/src/frontend/studio/live/hands-free-choice.ts` (header-comment fallback)_

Where "Start hands-free" processes, as the owner last chose it, remembered
per tenant in this browser. Nothing is preselected until the owner has chosen
once (ADR-0012: locality is the owner's decision and can only be tightened
after start, so it is never guessed). localStorage is optional and guarded.
