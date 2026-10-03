# products/interview/src/frontend/studio/workspace/use-canonical-draft.ts

_Source: `products/interview/src/frontend/studio/workspace/use-canonical-draft.ts` (header-comment fallback)_

What marks a draft as created by something other than its owner (an
assistant proposal or a session). An owner edit of the answer, briefing or
question clears it; any other edit moves `draftRevision` past
`acceptedDraftRevision`.
