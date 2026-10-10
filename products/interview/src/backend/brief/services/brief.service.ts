// The interview brief's use cases. Each opens ONE tenant transaction in the
// member's own scope and lets the repository settle ownership first; a
// refusal is a `BriefError` code. The routes parse and map; nothing here
// knows HTTP.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type PlatformDatabase,
  type TenantDatabase,
  withTenant,
} from "@omnitech/database";
import {
  CARRIED_RESEARCH_ID,
  INTERVIEW_BRIEF_BOUNDS,
  type StageRecording,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import { newestFirst, recordingOf } from "../domain/recording";
import {
  addEmployerSaid,
  addResearch,
  addStage,
  addTranscript,
  attachedRecordings,
  BriefError,
  type BriefScope,
  keepCarriedResearch,
  moveApplicationNotes,
  orderStages,
  ownSessionPolicies,
  readBrief,
  readResearch,
  readTranscriptDetail,
  removeEmployerSaid,
  removeResearch,
  removeStage,
  removeTranscript,
  updateEmployerSaid,
  updateResearch,
  updateStage,
  updateTranscript,
} from "../repository";
import { decodeTranscript } from "../transcript";

const BOUNDS = INTERVIEW_BRIEF_BOUNDS;
const uuid = z.uuid();

// The use cases that are one repository operation in one transaction.
const SINGLE_OPERATIONS = {
  readBrief,
  addStage,
  orderStages,
  updateStage,
  removeStage,
  moveApplicationNotes,
  addTranscript,
  readTranscriptDetail,
  updateTranscript,
  removeTranscript,
  addEmployerSaid,
  updateEmployerSaid,
  removeEmployerSaid,
  addResearch,
  updateResearch,
  removeResearch,
  keepCarriedResearch,
} as const;

type Scoped<Operation> = Operation extends (
  db: TenantDatabase,
  scope: BriefScope,
  ...rest: infer Rest
) => infer Result
  ? (scope: BriefScope, ...rest: Rest) => Result
  : never;

export type BriefService = ReturnType<typeof createBriefService>;

export function createBriefService(options: {
  database: PlatformDatabase;
  // Where the Studio's own recordings are written (transcript-recording.ts).
  recordingsDirectory?: string | undefined;
}) {
  const inTenant = <Result>(
    scope: BriefScope,
    work: (db: TenantDatabase) => Promise<Result>,
  ) => withTenant(scope, work, { database: options.database });

  const single = Object.fromEntries(
    Object.entries(SINGLE_OPERATIONS).map(([name, operation]) => [
      name,
      (scope: BriefScope, ...rest: unknown[]) =>
        inTenant(scope, (db) =>
          (operation as (...all: unknown[]) => Promise<unknown>)(
            db,
            scope,
            ...rest,
          ),
        ),
    ]),
  ) as {
    [Name in keyof typeof SINGLE_OPERATIONS]: Scoped<
      (typeof SINGLE_OPERATIONS)[Name]
    >;
  };

  // [SAFETY] A recording of another member's session is never listed and
  // never read: the session rows are private to their owner under forced
  // row-level security.
  async function ownRecordings(db: TenantDatabase, scope: BriefScope) {
    const directory = options.recordingsDirectory;
    if (!directory) return [];
    const names = await readdir(directory).catch(() => [] as string[]);
    const sessions = await ownSessionPolicies(db, scope);
    const found: Array<Omit<StageRecording, "attached"> & { path: string }> =
      [];
    for (const file of newestFirst(names)) {
      const recording = recordingOf(file, sessions);
      if (!recording) continue;
      const path = join(directory, file);
      const size = await stat(path).then(
        (entry) => entry.size,
        () => null,
      );
      // An empty file is a recording nothing was said in.
      if (size === null || size === 0) continue;
      found.push({
        file,
        startedAt: recording.startedAt,
        bytes: size,
        capturePolicy: recording.capturePolicy,
        path,
      });
    }
    return found;
  }

  return {
    ...single,

    // The member's recordings, each marked when this application has it.
    listRecordings: (scope: BriefScope, candidacyId: string) =>
      inTenant(scope, async (db) => {
        const attached = await attachedRecordings(db, scope, candidacyId);
        return (await ownRecordings(db, scope)).map(
          ({ path: _path, ...recording }) => ({
            ...recording,
            attached: attached.has(recording.file),
          }),
        );
      }),

    // "Attach the transcript I just recorded." The ids arrive as the request
    // named them: a recording that is not the member's is refused first.
    attachRecording: (
      scope: BriefScope,
      candidacyId: string,
      stageId: string,
      input: { file: string; title?: string | undefined },
    ) =>
      inTenant(scope, async (db) => {
        const recording = (await ownRecordings(db, scope)).find(
          (each) => each.file === input.file,
        );
        if (!recording) throw new BriefError("not-found");
        if (recording.bytes > BOUNDS.transcriptUploadBytes)
          throw new BriefError("body-too-large");
        const text = decodeTranscript(await readFile(recording.path));
        if (text === null) throw new BriefError("invalid-transcript");
        return addTranscript(
          db,
          scope,
          uuid.parse(candidacyId),
          uuid.parse(stageId),
          {
            title:
              input.title ?? `Recorded ${recording.startedAt.slice(0, 10)}`,
            origin: "recorded",
            originName: recording.file,
            // The policy of the session it was recorded in, never a choice.
            capturePolicy: recording.capturePolicy,
            occurredAt: recording.startedAt,
            text,
          },
        );
      }),

    // A research document by its id, or the carried-over text's stand-in.
    readResearchDocument: (
      scope: BriefScope,
      candidacyId: string,
      wanted: string,
    ) =>
      inTenant(scope, (db) => {
        // [GUARD] Anything that is neither names no document.
        if (wanted !== CARRIED_RESEARCH_ID && !uuid.safeParse(wanted).success)
          throw new BriefError("not-found");
        return readResearch(db, scope, uuid.parse(candidacyId), wanted);
      }),
  };
}
