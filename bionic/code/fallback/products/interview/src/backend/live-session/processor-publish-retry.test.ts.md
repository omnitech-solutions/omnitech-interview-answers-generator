# products/interview/src/backend/live-session/processor-publish-retry.test.ts

_Source: `products/interview/src/backend/live-session/processor-publish-retry.test.ts` (header-comment fallback)_

A publish that throws a transient error must not strand its action in flight
(S3): the action is recorded as failed, so the next tick retries the same
task revision within the bound and exactly one draft is published.
