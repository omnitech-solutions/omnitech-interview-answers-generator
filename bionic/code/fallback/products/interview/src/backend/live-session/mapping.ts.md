# products/interview/src/backend/live-session/mapping.ts

_Source: `products/interview/src/backend/live-session/mapping.ts` (header-comment fallback)_

Mapping between the database's underscore values and the neutral core's forms
(device_only <-> device-only, delete_at_end <-> delete-at-end). Only this
layer knows both; the core imports neither the database nor this file.
