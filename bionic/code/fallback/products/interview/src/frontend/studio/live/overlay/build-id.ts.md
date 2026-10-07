# products/interview/src/frontend/studio/live/overlay/build-id.ts

_Source: `products/interview/src/frontend/studio/live/overlay/build-id.ts` (header-comment fallback)_

The build the host baked in (see apps/web/next.config.ts). Next inlines each
NEXT_PUBLIC_* reference literally, so every name is written out in full.
id        short commit, "+" when the tree had uncommitted changes ("dev" if none)
sha       the full commit (the footer tag's tooltip and what it copies)
branch    the branch the build came from ("" when unknown)
packaged  a packaged app build: no developer tag is shown there
