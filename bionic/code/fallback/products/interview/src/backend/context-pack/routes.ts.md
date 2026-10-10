# products/interview/src/backend/context-pack/routes.ts

_Source: `products/interview/src/backend/context-pack/routes.ts` (header-comment fallback)_

The context pack of an application over HTTP (ADR-0041): its review, its
preparation by a model, and what the person corrects in it.

They are registered on the documents API's app, so its guard has already
settled the member (tenant, membership, `interview.read`, and
`interview.documents.write` for anything that is not a read). Ownership is
settled here before anything is read or prepared: the application's
candidate is the member, or the answer is `not-found`, to another member
of the workspace exactly as to another workspace.

GET  …/candidacies/:id/context-pack              the review
POST …/candidacies/:id/context-pack/prepare      prepare, as NDJSON lines
POST …/candidacies/:id/context-pack/corrections  confirm, edit or remove

[SAFETY] Preparing asks a model through the engine by PROFILE (rule 7): an
agent profile's calls run in the agent worker as agent jobs, exactly as a
document's do. A source that may not leave this machine is skipped by the
engine for a profile that does not run on it, and the review says so.
Nothing of what a source or a record says is logged here.

[SAFETY] The review is the person's own screen (the "Context pack" card in
the Interview form), read by the member the application is of and by no
one else, and it is where they check and correct what a model made of
their material. So it shows what a model that runs on this machine read
from a device-only transcript, and says so by reading as `reader:
"device"`. A review is answered to the browser and to nothing else: no
prompt is built from one. Every reader that does write a prompt (the coach,
a briefing, a document) reads the pack as a remote reader and is given
none of that (pack.ts).
