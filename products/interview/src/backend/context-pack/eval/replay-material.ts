// A person's material read from files, as the session of a recorded call
// would hold it, so the call can be replayed through the live coach WITH its
// context pack (apps/agent-worker/src/coach-replay.ts).
//
// PROBLEM: a replayed coach was given a plan and nothing else, so what its
// notes say could not be judged against the person's record. STRATEGY: the
// files (an experience matrix, an employer brief, optionally the application
// with its stages, the person's preferences and a pack a model prepared) are
// read into the same `SessionContext` the database reader gives a live
// session. Nothing is selected or ranked here: the coach's own context
// (coach/context.ts) prepares the pack from it, on the one path every coach
// takes. No model is called.
// COMPLEXITY: one read per file.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Prepared } from "@omnitech/ai-engine";
import type { BriefMaterial } from "../../brief/repository";
import type { SessionContext } from "../../live-session/session-context";
import { readBenchMaterial } from "../bench";
import { stageContext } from "../bench-stages";
import { stageFor } from "../stage";

export type ReplayMaterialPaths = {
  // An experience matrix.
  matrix: string;
  // An employer brief, or an application row holding one under
  // `employer_brief` (bench.ts).
  brief: string;
  // The application: its stages, what the employer said, the research. A
  // transcript may name its words by `textFile`, a path from this file's
  // folder, instead of holding them in `text`.
  application?: string | undefined;
  // The person's preferences, as lines of text.
  preferences?: string | undefined;
  // A pack a model prepared earlier: the `Prepared` itself, or an object
  // holding it under `prepared`.
  kept?: string | undefined;
  // The stage the call is, by its place (1 is the first). The call is not
  // yet over when it is coached: that stage's own transcripts, outcome and
  // next steps are left out of the material.
  stage?: number | undefined;
};

export type ReplayMaterial = {
  context: SessionContext;
  kept?: Prepared;
  // The employer of each role, by its place in the matrix: a fact at
  // "/roles/2/…" is employers[2]'s.
  employers: string[];
};

// [SAFETY] Says which file was wrong and how, never what it holds.
export class ReplayMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayMaterialError";
  }
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function json(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ReplayMaterialError(`${what} could not be read: ${path}`);
  }
}

// The application with each transcript's words in hand.
function readApplication(path: string): BriefMaterial {
  const held = json(path, "The application") as Partial<BriefMaterial> | null;
  // [GUARD] An application is its stages: a file without them is another
  // file, and none of it is read.
  if (!held || !Array.isArray(held.stages))
    throw new ReplayMaterialError(`The application has no stages: ${path}`);
  const folder = dirname(path);
  return {
    candidacyId: held.candidacyId ?? "replay",
    ...(held.posting === undefined ? {} : { posting: held.posting }),
    employerSaid: held.employerSaid ?? [],
    research: held.research ?? [],
    stages: held.stages.map((stage) => ({
      ...stage,
      people: stage.people ?? [],
      transcripts: (stage.transcripts ?? []).map((transcript) => {
        const { textFile, ...rest } = transcript as typeof transcript & {
          textFile?: string;
        };
        if (typeof textFile !== "string") return transcript;
        let text: string;
        try {
          text = readFileSync(resolve(folder, textFile), "utf8");
        } catch {
          throw new ReplayMaterialError(
            `A transcript's text file could not be read: ${resolve(folder, textFile)}`,
          );
        }
        // A transcript's revision is its words (brief-sources.ts).
        return { ...rest, text, sha256: rest.sha256 ?? sha256(text) };
      }),
    })),
  };
}

function readKept(path: string): Prepared {
  const held = json(path, "The kept pack") as
    | (Partial<Prepared> & { prepared?: Partial<Prepared> })
    | null;
  const prepared = held?.prepared ?? held;
  // [GUARD] A pack is its sources, its records and the recipe that made it.
  if (
    !prepared ||
    !Array.isArray(prepared.sources) ||
    !Array.isArray(prepared.records) ||
    typeof prepared.recipe?.id !== "string"
  )
    throw new ReplayMaterialError(`That file holds no prepared pack: ${path}`);
  return { ...prepared, rejected: prepared.rejected ?? [] } as Prepared;
}

export function readReplayMaterial(paths: ReplayMaterialPaths): ReplayMaterial {
  // The person's own material, read and checked as the pack's benchmark
  // reads it.
  let material: ReturnType<typeof readBenchMaterial>;
  try {
    material = readBenchMaterial({
      matrix: paths.matrix,
      brief: paths.brief,
      ...(paths.preferences ? { preferences: paths.preferences } : {}),
    });
  } catch {
    throw new ReplayMaterialError(
      "The matrix, the employer brief or the preferences could not be read, or is not what its name says.",
    );
  }
  const read = paths.application ? readApplication(paths.application) : null;
  // [SAFETY] The call being replayed IS the stage named: a live coach has no
  // transcript of the call it is listening to, and nothing written after it
  // (the outcome, the next steps). Left in, the coach would be handed what
  // the person went on to answer, and every note would be scored on a leak.
  // An earlier stage's transcript and outcome stay: those are known.
  const application =
    read && paths.stage !== undefined
      ? {
          ...read,
          stages: read.stages.map((stage) =>
            stage.ordinal === paths.stage
              ? { ...stage, transcripts: [], outcome: null, nextSteps: null }
              : stage,
          ),
        }
      : read;

  // The session as it holds that material (bench-stages.ts), with no
  // application when none was given.
  const whole = stageContext(material, application as BriefMaterial);
  const held = whole.material as NonNullable<SessionContext["material"]>;
  const base: SessionContext = {
    ...whole,
    material: { ...held, interviewBrief: application },
  };

  // [GUARD] The stage the call is must be one the application has: a place
  // it does not have would silently read every stage as one.
  let stage = null;
  if (paths.stage !== undefined) {
    if (!application)
      throw new ReplayMaterialError("A stage needs the application it is of.");
    stage = stageFor(base, paths.stage);
    if (!stage)
      throw new ReplayMaterialError(
        `The application has no stage ${paths.stage}.`,
      );
  }

  return {
    context: {
      ...base,
      material: { ...held, interviewBrief: application, stage },
    },
    ...(paths.kept ? { kept: readKept(paths.kept) } : {}),
    employers: material.matrix.roles.map((role) => role.company),
  };
}
