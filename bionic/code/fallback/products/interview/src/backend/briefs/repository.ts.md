# products/interview/src/backend/briefs/repository.ts

_Source: `products/interview/src/backend/briefs/repository.ts` (header-comment fallback)_

Spoken briefs (`interview.concept_briefs`): persistence only. Every function
takes the tenant-bound transaction the caller opened and returns rows; what a
missing row means is the caller's decision.
