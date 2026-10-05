# products/interview/src/frontend/studio/live/host-capability-parity.test.ts

_Source: `products/interview/src/frontend/studio/live/host-capability-parity.test.ts` (header-comment fallback)_

The Mac shell advertises its capabilities as `HostCapability` in Swift; the
page negotiates them against STUDIO_HOST_CAPABILITIES. Swift stays its own
source of truth, read as text (like shared/shortcuts.test.ts), so a name added
or renamed on one side only fails here instead of silently disabling a feature.
