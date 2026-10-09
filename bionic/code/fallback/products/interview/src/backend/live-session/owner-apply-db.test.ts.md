# products/interview/src/backend/live-session/owner-apply-db.test.ts

_Source: `products/interview/src/backend/live-session/owner-apply-db.test.ts` (header-comment fallback)_

Apply on the answer page (D28/D30), on a disposable PostgreSQL as the member
role (requires Docker, like the other session suites): one atomic request
makes exactly ONE new revision of a task (target) or ONE new task (no target)
from 0..N images, in the order sent; regenerate re-runs a task from the same
sources. The real processor and assist stage run over a scripted fake engine;
only counts, ids, order and marker wording are asserted, never content.
