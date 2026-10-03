# apps/capture-companion/src/capability.ts

_Source: `apps/capture-companion/src/capability.ts` (header-comment fallback)_

The on-device speech capability check (D5). Recognition is always on this
device, so a Mac that cannot do it fails VISIBLY: no source starts, the
heartbeat says capturing:false, and capability.report tells Studio why. The
report carries support and permission states only, never content.
