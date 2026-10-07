# products/interview/src/frontend/studio/live/overlay/build-tag.ts

_Source: `products/interview/src/frontend/studio/live/overlay/build-tag.ts` (header-comment fallback)_

The dev build tag: short SHA and branch, shown ONLY on a build that is not
packaged. The shell says what it was built from (studioHost.build); a shell
that says nothing leaves the page's own build id (build-id.ts), which is
treated as unpackaged, as the old footer showed it. Pure apart from the hook.
