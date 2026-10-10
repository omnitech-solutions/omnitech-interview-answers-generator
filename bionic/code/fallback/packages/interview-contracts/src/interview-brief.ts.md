# packages/interview-contracts/src/interview-brief.ts

_Source: `packages/interview-contracts/src/interview-brief.ts` (header-comment fallback)_

[DOMAIN] The interview brief (BRIEF-interview-brief-and-context-pack,
section 3): everything a person has for ONE application. The application
itself (company, role, posting), what the employer said (dated entries),
what the person found out (research documents), and, for each STAGE, who
they meet, what they prepared, what was actually said (transcripts) and how
it went (outcome). These are the shapes the routes under
/api/interview/documents/candidacies/:id/… read and write.

[SAFETY] Every size is bounded here, at the contract: nothing larger is
parsed, stored or handed to a reader.
