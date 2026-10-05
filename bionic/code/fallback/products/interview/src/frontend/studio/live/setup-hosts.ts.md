# products/interview/src/frontend/studio/live/setup-hosts.ts

_Source: `products/interview/src/frontend/studio/live/setup-hosts.ts` (header-comment fallback)_

The Setup host cards as data: the two places Studio can hear and see from,
and the capability lines each card shows. Every line's state comes from a
real fact passed in (the native bridge, the companion's last report, the
browser's own abilities); what a fact cannot tell is "unknown", never a claim.
Pure: no React, no reading of window, so each state is tested directly.
