# products/interview/src/frontend/studio/studio.tsx

_Source: `products/interview/src/frontend/studio/studio.tsx` (header-comment fallback)_

[GUARD] With no view lending a draft, the shell never loaded one, so it
asks the server which revision the assistant would read instead of
claiming one. A turn is still rejected if the draft moves after this.
