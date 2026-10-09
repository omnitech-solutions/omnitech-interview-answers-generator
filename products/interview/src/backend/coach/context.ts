// What the coach knows about the person, for one stretch of conversation: the
// facts of their approved record that bear on what was just said.
//
// STRATEGY: nothing new is read or ranked here. The live session already has
// its approved context (the pinned experience matrix, the employer brief, the
// person's preferences) and one ranking of it against what was asked; the
// coach reads the same context through the same ranking, in the session
// owner's scope, so it can never see more than the session's own answers do.
import type { PlatformDatabase } from "@omnitech/database";
import type { CoachTranscriptSession } from "@omnitech/interview-contracts";
import { selectSourcesForTask } from "../live-session/context-snapshot";
import {
  loadSessionContext,
  type SessionContext,
} from "../live-session/session-context";

export type CoachFact = {
  // Where it is in the person's material ("/roles/3/proof_points/1").
  pointer: string;
  text: string;
  // "candidate": the person's own record, which a note may state as theirs.
  // "employer": about the company and the role, never the person's experience.
  // "preference": what the person wants (notice, pay, how they work).
  about: "candidate" | "employer" | "preference";
};

export type CoachContextPort = {
  // The facts for `query`, best first. Empty when the session has no context.
  facts(session: CoachTranscriptSession, query: string): Promise<CoachFact[]>;
};

const ABOUT = {
  candidate: "candidate",
  "employer-context": "employer",
  "candidate-preference": "preference",
} as const;
// A record is re-read this often: an edit made during the interview shows up
// in the next minute's notes without a read on every one.
const HELD_MS = 60_000;

export function createCoachContext(
  database: PlatformDatabase,
  nowMs: () => number = Date.now,
): CoachContextPort {
  let held:
    | { sessionId: string; at: number; context: SessionContext | null }
    | undefined;
  return {
    async facts(session, query) {
      if (
        !held ||
        held.sessionId !== session.sessionId ||
        nowMs() - held.at > HELD_MS
      ) {
        // [SAFETY] A session that is gone, or whose pinned record no longer
        // verifies, gives the coach nothing: it then coaches from the
        // conversation alone and marks what it claims as its own inference.
        const context = await loadSessionContext(
          database,
          { tenantId: session.tenantId, actorId: session.actorId },
          session.sessionId,
        ).catch(() => null);
        held = { sessionId: session.sessionId, at: nowMs(), context };
      }
      if (!held.context) return [];
      return selectSourcesForTask(held.context.snapshot, {
        query,
        category: "other",
        matrix: held.context.matrix,
      }).map((source) => ({
        pointer: source.pointer,
        text: source.text,
        about: ABOUT[source.sourceKind],
      }));
    },
  };
}
