// The database reader of a session's approved context (ADR-0011/0012, plan #2
// D5): the pinned candidate-profile revision, the linked briefing draft's
// employer material and the candidate's own preferences, assembled into one
// ContextSnapshot. Everything is read in an owner-scoped transaction (forced
// row security binds the actor), so another same-tenant user's profile or
// draft reads as absent (rule:owner-checked-read-paths,
// rule:linked-resource-authorization).
//
// A pinned profile that cannot be read, whose matrix no longer parses, or
// whose bytes no longer hash to the sha256 recorded at pin time is NOT replaced
// by a stale or partial answer: the context is unavailable, a coded failure the
// dispatcher records as retryable (the context fails closed). A session with no pinned
// profile has a snapshot with profile null: the stage still answers with
// interpretation and general knowledge, and no matrix-backed claim can verify.
//
// Errors carry a code only, never content.
import type { PlatformDatabase } from "@omnitech/database";
import {
  briefingDraftSchema,
  type CandidateMatrix,
  candidateMatrixSchema,
} from "@omnitech/interview-contracts";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import {
  buildContextSnapshot,
  type ContextSnapshot,
  verifyMatrixHash,
} from "./context-snapshot.js";
import { assertUuid, SessionError } from "./errors.js";
import { decodeDraftKey } from "./mapping.js";
import { firstRow, inOwnerScope, type OwnerScope } from "./scope.js";
import { readSession } from "./session-record.js";

export type SessionContext = {
  snapshot: ContextSnapshot;
  // The verified matrix the task ranking reads; null when no profile is pinned.
  matrix: CandidateMatrix | null;
};

export type ContextUnavailableCode =
  | "profile_unreadable"
  | "profile_invalid"
  | "profile_hash_mismatch";

export class SessionContextUnavailable extends Error {
  readonly code: "context_unavailable" = "context_unavailable";
  constructor(readonly reason: ContextUnavailableCode) {
    super("The session's approved context is unavailable.");
    this.name = "SessionContextUnavailable";
  }
}

type DraftRow = { revision: unknown; value: unknown };

export async function loadSessionContext(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<SessionContext> {
  assertUuid(sessionId);
  return inOwnerScope(database, scope, async (tx) => {
    const record = await readSession(tx, scope, sessionId);
    if (!record) throw new SessionError("not_found");

    // The pinned matrix revision, hash re-verified.
    let matrix: CandidateMatrix | null = null;
    let profile: { id: string; revision: number; sha256: string } | null = null;
    if (record.profileId !== null && record.profileRevision !== null) {
      const row = await firstRow<{ matrix: unknown; sha256: string }>(
        tx,
        sql`SELECT r.matrix, r.sha256
            FROM interview.candidate_profile_revisions r
            JOIN interview.candidate_profiles p
              ON (p.tenant_id, p.actor_id, p.product_id, p.id)
               = (r.tenant_id, r.actor_id, r.product_id, r.id)
            WHERE r.tenant_id = ${scope.tenantId}
              AND r.actor_id = ${scope.actorId}
              AND r.product_id = ${INTERVIEW_PRODUCT_ID}
              AND r.id = ${record.profileId}
              AND r.revision = ${record.profileRevision}
              AND p.revoked_at IS NULL`,
      );
      if (!row) throw new SessionContextUnavailable("profile_unreadable");
      const parsed = candidateMatrixSchema.safeParse(row.matrix);
      if (!parsed.success)
        throw new SessionContextUnavailable("profile_invalid");
      if (!verifyMatrixHash(parsed.data, String(row.sha256)))
        throw new SessionContextUnavailable("profile_hash_mismatch");
      matrix = parsed.data;
      profile = {
        id: record.profileId,
        revision: record.profileRevision,
        sha256: String(row.sha256),
      };
    }

    // The linked briefing draft: employer material (untrusted) and the
    // candidate's own preferences. A draft that is gone, or has no briefing,
    // simply adds no context.
    let employer:
      | {
          jobDescription?: string | undefined;
          employerNotes?: string | undefined;
          research?: string | undefined;
        }
      | undefined;
    let candidatePreferences: string | undefined;
    let draftRevision: number | undefined;
    let key: ReturnType<typeof decodeDraftKey> = null;
    try {
      key = decodeDraftKey(record.workspaceDraftId);
    } catch {
      key = null;
    }
    if (key) {
      const draft = await firstRow<DraftRow>(
        tx,
        sql`SELECT revision, value FROM interview.assistant_drafts
            WHERE tenant_id = ${scope.tenantId}
              AND actor_id = ${scope.actorId}
              AND product_id = ${INTERVIEW_PRODUCT_ID}
              AND workspace_id = ${key.workspaceId}
              AND artifact_id = ${key.artifactId}`,
      );
      const briefing = briefingDraftSchema.safeParse(
        (draft?.value as { briefing?: unknown } | undefined)?.briefing,
      );
      if (draft && briefing.success) {
        const { jobDescription, employerNotes, research } =
          briefing.data.context;
        employer = { jobDescription, employerNotes, research };
        candidatePreferences = briefing.data.context.candidatePreferences;
        draftRevision = Number(draft.revision);
      }
    }

    return {
      matrix,
      snapshot: buildContextSnapshot({
        matrix,
        profile,
        employer,
        candidatePreferences,
        draftRevision,
      }),
    };
  });
}
