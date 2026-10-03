# products/interview/src/backend/live-session/scope.ts

_Source: `products/interview/src/backend/live-session/scope.ts` (header-comment fallback)_

Every Active Session call runs in an actor-scoped transaction for the session
OWNER: tenant, actor and product are set by withTenant, so forced row
security binds every query (rule:owner-checked-read-paths,
rule:actor-private-session-rows).
