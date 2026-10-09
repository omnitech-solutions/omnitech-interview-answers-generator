// What the coach knows about the person, for one stretch of conversation: the
// facts of their approved record that bear on what was just said.
//
// STRATEGY: nothing is read or ranked here. The session's approved material
// (the pinned experience matrix, the employer brief, the person's
// preferences) is read in the session owner's scope, prepared once into the
// context pack (ADR-0038), and the pack's "coach" projection is resolved for
// each stretch. The coach is given exactly what that projection selects.
import type { PlatformDatabase } from "@omnitech/database";
import type { CoachTranscriptSession } from "@omnitech/interview-contracts";
import {
  type ContextEngine,
  type ContextPack,
  prepareContextPack,
  sessionSources,
} from "../context-pack/index";
import { loadSessionContext } from "../live-session/session-context";

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

// The material is re-read this often: an edit made during the interview
// shows up in the next minute's notes without a read on every one.
const HELD_MS = 60_000;

export function createCoachContext(
  database: PlatformDatabase,
  engine: ContextEngine,
  nowMs: () => number = Date.now,
): CoachContextPort {
  let held:
    | { sessionId: string; at: number; pack: ContextPack | null }
    | undefined;
  return {
    async facts(session, query) {
      if (
        !held ||
        held.sessionId !== session.sessionId ||
        nowMs() - held.at > HELD_MS
      ) {
        const scope = { tenantId: session.tenantId, actorId: session.actorId };
        // [SAFETY] A session that is gone, whose pinned record no longer
        // verifies, or whose material the recipe refuses gives the coach
        // nothing: it then coaches from the conversation alone and marks
        // what it claims as its own inference.
        const pack = await loadSessionContext(
          database,
          scope,
          session.sessionId,
        )
          .then((context) =>
            prepareContextPack(engine, sessionSources(context), {
              scope,
              signal: new AbortController().signal,
              for: { kind: "session", id: session.sessionId },
            }),
          )
          .catch(() => null);
        held = { sessionId: session.sessionId, at: nowMs(), pack };
      }
      if (!held.pack) return [];
      return held.pack.facts("coach", query).map((fact) => ({
        pointer: fact.pointer,
        // A looked-up field says what it is ("Company: Northwind").
        text: fact.exact
          ? `${LABEL[fact.slot] ?? fact.slot}: ${fact.text}`
          : fact.text,
        about: fact.about,
      }));
    },
  };
}

const LABEL: Readonly<Record<string, string>> = {
  "candidate.name": "Name",
  "candidate.headline": "Headline",
  "candidate.location": "Location",
  "employer.company": "Company",
  "employer.role": "Role",
};
