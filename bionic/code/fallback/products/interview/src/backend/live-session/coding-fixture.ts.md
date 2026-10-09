# products/interview/src/backend/live-session/coding-fixture.ts

_Source: `products/interview/src/backend/live-session/coding-fixture.ts` (header-comment fallback)_

Test support for the coding path suites: a scripted fake engine that answers
the prose call with a coding draft and the solution call with a closed
solution, a fake runner that reports the tests the code declares, and the
synthetic spoken lines of a live-coding exchange (Interviewer and Candidate
placeholders only). Tests, not production code, import this.
