---
title: "Behavioural briefing packs: operator runbook"
slug: interview-briefings-runbook
type: references
tags: [interview, briefings, runbook, cli]
sources: []
last_reviewed: 2026-10-02
---

# Behavioural briefing packs: operator runbook

Provenance: filed from the former `docs/interview-briefings.md` (commit
`4c50c5e`). The Studio around it is described in
[[research/references/interview-studio]]; generation goes through the AI
gateway decided in
[[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]].

## Start and prepare a pack

Run `pnpm dev` and open Interview Studio's Briefings at
`http://127.0.0.1:3000/t/local/p/interview/briefings`. Choose **New briefing**
(+), pick **Behavioural**, then **Start a preparation pack**; saved packs are
listed on the left. `interview-answers briefing open` opens Briefings in the
running studio.

When the local default matrix is configured and the actor has no profiles, the
host imports it as `local-experience-matrix` and selects it for a new pack. A
saved pack keeps its own selected profile revision. You can instead import a
candidate matrix JSON file or paste its JSON into the preparation view; review
the identity, roles, story choices, and missing proof points before confirming
import. Select an immutable profile revision, enter the company, role, stage,
and questions, then generate a proposal. Review each answer, talking points,
evidence, and gaps before **Apply proposal**. Edit as needed and **Save
complete pack** to create an immutable saved revision. Applying a proposal
changes the draft; saving is a separate action. **New pack** starts a separate
artifact and asks before discarding unsaved work. Existing packs are available
under **Available packs → Open**.

The CLI uses `--url` or `INTERVIEW_API_URL` for the API origin (default
`http://127.0.0.1:3000`), and `--token` or `INTERVIEW_API_TOKEN` when required.
Its default tenant is `local`; `--tenant` overrides it. Authenticated sessions
may be required. Replace the uppercase placeholders below with actual IDs and
revisions returned by the commands; do not put private profile content or
credentials in shell history.

```bash
interview-answers briefing profiles
interview-answers briefing import --file ./candidate-matrix.json --name "Candidate profile"
interview-answers briefing show --id PROFILE_ID --revision 1
interview-answers briefing artifacts
interview-answers briefing show --id PACK_ID
interview-answers briefing edit --id PACK_ID --file ./briefing-put.json
interview-answers briefing propose --id PACK_ID --file ./briefing-proposal.json
interview-answers briefing apply --id PACK_ID --proposal PROPOSAL_ID --revision BASE_REVISION
interview-answers briefing save --id PACK_ID --revision DRAFT_REVISION --request-id REQUEST_ID
```

`edit` reads `{ "expectedRevision": number, "briefing": BriefingDraft }`;
`propose` reads a `BriefingProposalRequest` JSON object. See
`packages/interview-contracts/src/briefing.ts` for the exact schemas. The CLI
`import` command creates a profile; reimporting a selected profile as its next
immutable revision is available in the UI. Keep the same request ID when
retrying one save after an uncertain response.

## Failures and recovery

| Result | Operator action |
| --- | --- |
| Import rejected (`400` or `413`) | Check the JSON against the matrix schema, inspect missing proof points in the preview, and use a file within the 1 MiB request limit. Nothing is imported on validation failure. |
| Unauthorized (`401`) or forbidden origin (`403`) | Use an authorized host session or configured CLI access. Do not bypass the host's tenant, actor, product, or origin checks. |
| Profile or pack unavailable (`404`) | Check the selected profile ID/revision and access to its source. A removed or revoked profile is excluded from lists and blocks derived pack reads, proposal application, and saving. Ask the authorized data owner to resolve source access; do not copy the matrix into a public knowledge store. |
| Revision conflict (`409`) | Keep the local draft. Compare it with the server version, then deliberately reload and reapply local changes or regenerate a proposal against the current revision. A proposal based on an older draft or changed source cannot be applied. |
| Generation unavailable (`503`) | Confirm a model is configured and reachable; retry generation after correcting the provider. A failed proposal may leave already-synced draft edits, but does not apply or save an answer. |

The preparation view keeps local edits on a conflict and offers server reload
only as an explicit choice. Do not select **Reload server version** until the
local changes have been reviewed: it replaces the local draft. Changing the
company, stage, questions, or profile can make existing answers stale; generate
and apply a new proposal before saving. Source revocation is an administrative
data action, not a preparation UI or CLI command. It does not require deleting
saved rows; the API rechecks profile access when reading and saving.

## Provider and API boundaries

Briefing generation uses the host's existing AI gateway. Configure a reachable
OpenAI-compatible provider through the existing `AI_BASE_URL` and `AI_MODEL`
settings, or the documented `OPENAI_*` / `LM_STUDIO_*` settings in `README.md`;
use the host's normal secret management for provider credentials.

The optional local default loader reads `INTERVIEW_DEFAULT_MATRIX_PATH` when
set, otherwise `INTERVIEW_DATA_DIR/default-experience-matrix.json`, otherwise
`.data/default-experience-matrix.json` relative to the host process. The matrix
file stays in an ignored `.data` directory. It is disabled in production and
requires `FAKE_AUTH_ENABLED=true` with the local development user and tenant.
Other users import through the UI or CLI.

The implemented API prefix is `/api/interview/briefing`. Its routes are
`GET/POST /profiles`, `GET /profiles/:id/revisions/:revision`,
`GET /artifacts`, `GET/PUT /artifacts/:id`, and
`POST /artifacts/:id/proposals`, `/artifacts/:id/apply`,
`/artifacts/:id/save`. Request bodies and responses use
`@omnitech/interview-contracts`; the CLI and UI use
`@omnitech/interview-api-client`.

## Implementation notes

The implementation differs from the original plan in three places: a briefing
is an optional `briefing` field on the existing workspace draft record, rather
than a separate discriminated draft payload; private profile/revision and
proposal tables hold profile versions and proposal source snapshots while
drafts and saved revisions use the existing `briefings` workspace repository;
and the routes above replace the plan's proposed `/profiles/import` and
`/workspaces/.../briefing-proposals` routes. No candidate matrix fixture is
committed. To roll back the UI, remove the preparation navigation/view through
a reviewed code change while retaining imported profiles and saved packs; do
not drop their tables or rows.

This runbook describes source-inspected behavior. It does not assert a live
browser, provider, or PostgreSQL verification.
