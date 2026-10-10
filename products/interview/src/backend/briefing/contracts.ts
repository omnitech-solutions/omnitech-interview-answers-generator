import type {
  BriefingContext,
  BriefingDraft,
  CandidateMatrix,
} from "@omnitech/interview-contracts";
export type ProfileVersion = Readonly<{
  id: string;
  name: string;
  revision: number;
  sha256: string;
  matrix: CandidateMatrix;
}>;
export type ExistingProfile = Readonly<{
  revision: number;
  revoked: boolean;
}>;
export type ProposalRecord = Readonly<{
  id: string;
  artifactId: string;
  baseRevision: number;
  profileId: string;
  profileRevision: number;
  profileSha256: string;
  briefing: BriefingDraft;
  sourceSnapshot: unknown;
}>;

import { briefingPreparedContentSchema } from "@omnitech/interview-contracts";
import { z } from "zod";
import type {
  WorkspaceDatabasePort,
  WorkspaceScope,
} from "../assistant/workspace";
import type { StructuredGenerate } from "../structured";
export const citationSchema = z.strictObject({
  text: z.string().min(1),
  sourceKind: z.enum(["candidate", "employer-context", "candidate-preference"]),
  pointer: z.string(),
  quote: z.string(),
});
export const preparedModelSchema = briefingPreparedContentSchema.extend({
  citations: z.array(citationSchema).max(64),
  gaps: z.array(z.string()).max(32),
});
export const modelSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        id: z.string(),
        answerMarkdown: z.string().max(32_000),
        talkingPoints: z.array(z.string()).length(3),
        citations: z
          .array(
            z.strictObject({
              field: z.enum(["answerMarkdown", "talkingPoints"]),
              text: z.string().min(1),
              sourceKind: z.enum([
                "candidate",
                "employer-context",
                "candidate-preference",
              ]),
              pointer: z.string(),
              quote: z.string(),
            }),
          )
          .max(32),
        gaps: z.array(z.string()).max(32),
      }),
    )
    .max(20),
});
export type Source = {
  pointer: string;
  text: string;
  sourceKind: "candidate" | "employer-context" | "candidate-preference";
  id: string;
  revision: number;
  sha256: string;
};
export const sourceSnapshotSchema = z.array(
  z.strictObject({
    pointer: z.string(),
    text: z.string(),
    sourceKind: z.enum([
      "candidate",
      "employer-context",
      "candidate-preference",
    ]),
    id: z.string(),
    revision: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);

export const condensedModelSchema = z.strictObject({
  jobDescription: z.string().max(32_000),
  research: z.string().max(32_000),
});
export type BriefingDependencies = {
  database: WorkspaceDatabasePort;
  generate: StructuredGenerate;
  // What a model prepared for the member's application to this company for
  // this role, as lines of the stage the briefing is for (context-pack/
  // application.ts): who is met, what the employer asks for with the evidence
  // and the gaps, and what earlier stages asked. Empty when no pack was
  // prepared: the briefing is then written from what it always was.
  packContext?: (
    scope: WorkspaceScope,
    context: BriefingContext,
  ) => Promise<{ pointer: string; text: string }[]>;
  loadDefaultProfile?: (
    scope: WorkspaceScope,
  ) => Promise<{ name: string; matrix: unknown } | null>;
};
