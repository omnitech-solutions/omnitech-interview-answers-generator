// What the coach knows about the person, for one stretch of conversation: the
// facts of their approved record that bear on what was just said.
//
// STRATEGY: nothing is read or ranked here. The session's approved material
// (the pinned experience matrix, the employer brief, the person's
// preferences) is read in the session owner's scope, prepared once into the
// context pack (ADR-0038), and the pack's "coach" projection is resolved for
// each stretch. The coach is given exactly what that projection selects.
import type { Prepared } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import type { CoachTranscriptSession } from "@omnitech/interview-contracts";
import {
  type ContextEngine,
  type ContextPack,
  KINDS,
  keptFor,
  type PackStore,
  prepareContextPack,
  sessionSources,
} from "../context-pack/index";
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
  // "notes": the person's own notes for this interview and what they said and
  // promised in an earlier stage. Theirs to say, and never the verified
  // record: no claim is verified against them.
  about: "candidate" | "employer" | "preference" | "notes";
};

// [DOMAIN] The kinds that are the person's own words about this interview:
// what they prepared to say, and what they answered and promised before. The
// pack files them with the employer's material (they are not the approved
// record); the coach is told whose they are.
const OWN_NOTES: ReadonlySet<string> = new Set([
  KINDS.prep,
  KINDS.answered,
  KINDS.commitment,
]);

export type CoachContextPort = {
  // The facts for `query`, best first. Empty when the session has no context.
  facts(session: CoachTranscriptSession, query: string): Promise<CoachFact[]>;
};

// What a session's pack is prepared from: its approved material, and the pack
// a model prepared for its application when one is kept.
export type CoachMaterial = {
  context: SessionContext;
  kept?: Prepared | undefined;
};

// The material is re-read this often: an edit made during the interview
// shows up in the next minute's notes without a read on every one.
const HELD_MS = 60_000;

export function createCoachContext(
  database: PlatformDatabase,
  engine: ContextEngine,
  nowMs: () => number = Date.now,
  // Where prepared context packs are kept. Given, the coach also reads what
  // a model extracted for the session's application (requirements with their
  // quotes, what earlier stages asked and signalled, the fit). It is READ
  // here, never prepared: no model is called on the coach's path, and with
  // no kept pack the coach has exactly the person's material as it stands.
  packs?: PackStore,
): CoachContextPort {
  return createCoachContextFrom(
    engine,
    async (session) => {
      const scope = { tenantId: session.tenantId, actorId: session.actorId };
      const context = await loadSessionContext(
        database,
        scope,
        session.sessionId,
      );
      // A store that does not answer is no kept pack (prepare.ts).
      return { context, kept: await keptFor(packs, scope, context) };
    },
    nowMs,
  );
}

// [DOMAIN] The same coach context, with the session's material read by
// whoever holds it: the database for a live session (above), files for a
// recorded call replayed as a benchmark. Everything after the read is one
// path, so a replayed coach is given exactly what a live one would be.
export function createCoachContextFrom(
  engine: ContextEngine,
  read: (session: CoachTranscriptSession) => Promise<CoachMaterial>,
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
        const pack = await read(session)
          .then(({ context, kept }) =>
            prepareContextPack(
              engine,
              sessionSources(context),
              {
                scope,
                signal: new AbortController().signal,
                for: { kind: "session", id: session.sessionId },
              },
              {
                kept,
                // What was extracted from a stage's transcript is given to
                // the stage the session is in after that stage's own, and a
                // later stage's is left out.
                stage: context.material?.stage?.ordinal,
                // [SAFETY] The coach's prompt is sent to a model that does
                // not run on this machine (coach.ts sends it as
                // "permitted-remote"; the worker runs the coach on Claude
                // Code or Codex and on nothing else). So a device-only
                // transcript, and what a local model extracted from one, is
                // no part of this pack. Said outright, though it is the
                // pack's default.
                reader: "remote",
              },
            ),
          )
          .catch(() => null);
        held = { sessionId: session.sessionId, at: nowMs(), pack };
      }
      if (!held.pack) return [];
      return held.pack.facts("coach", query).map((fact) => ({
        // A looked-up field has its own address under its record's
        // ("/candidate/name"), so two fields of one record are two facts.
        pointer: fact.exact
          ? `${fact.pointer}/${fact.slot.split(".").at(-1)}`
          : fact.pointer,
        // A looked-up field says what it is ("Company: Northwind").
        text: fact.exact
          ? `${LABEL[fact.slot] ?? fact.slot}: ${fact.text}`
          : fact.text,
        about: OWN_NOTES.has(fact.kind) ? "notes" : fact.about,
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
