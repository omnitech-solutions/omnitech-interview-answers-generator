import {
  type BriefingContext,
  type briefingCondenseSchema,
  briefingDraftSchema,
  type briefingPrepareSchema,
} from "@omnitech/interview-contracts";
import { createLogger } from "@omnitech/logging";
import type { z } from "zod";
import {
  InterviewWorkspaceRepository,
  WorkspaceError,
  type WorkspaceScope,
} from "../../assistant/workspace";
import { generateChecked } from "../../structured";
import type { BriefingDependencies } from "../contracts";
import { condensedModelSchema, preparedModelSchema } from "../contracts";
import { artifactRevisionError } from "../domain/artifacts";
import {
  condenseBudget,
  condenseMaterial,
  shorterMaterial,
  withCondensedContext,
} from "../domain/condensing";
import { validatePrepared } from "../domain/grounding";
import { briefContext } from "../domain/sources";
import { CONDENSE_SYSTEM, PREPARE_SYSTEM } from "../prompts";
import { sourcesFor } from "./answers.service";

const log = createLogger({ service: "briefing" });
export async function prepareArtifact(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
  input: z.infer<typeof briefingPrepareSchema>,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const current = await workspace.read(scope, "briefings", artifactId);
  const briefing = current.value.briefing;
  if (!briefing) throw new WorkspaceError("not-found");
  const revisionError = artifactRevisionError(
    current.origin.artifactRevision,
    input.expectedRevision,
  );
  if (revisionError) throw new WorkspaceError(revisionError);
  const contextWithRequest: BriefingContext = {
    ...briefing.context,
    ...(input.request ? { request: input.request } : {}),
  };
  const { profile, sources } = await sourcesFor(
    options,
    scope,
    contextWithRequest,
    briefing.questions,
    [],
    current.origin.artifactRevision,
  );
  const generated = await generateChecked(
    options.generate,
    {
      system: PREPARE_SYSTEM,
      prompt: JSON.stringify({
        context: briefContext(contextWithRequest),
        questions: briefing.questions.map(({ question, category }) => ({
          question,
          category,
        })),
        // The roles a story may come from, by pointer.
        roles: profile.matrix.roles.map((role, index) => ({
          roleId: `/roles/${index}`,
          company: role.company,
          title: role.title,
        })),
        sources: sources.map(({ pointer, text, sourceKind }) => ({
          pointer,
          text,
          sourceKind,
        })),
      }),
    },
    preparedModelSchema,
    scope,
  );
  const updated = await workspace.edit(scope, current.origin, {
    briefing: briefingDraftSchema.parse({
      ...briefing,
      context: contextWithRequest,
      prepared: validatePrepared(
        generated,
        sources,
        profile.matrix.roles.length,
      ),
    }),
  });
  return updated;
}

export async function condenseArtifact(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
  input: z.infer<typeof briefingCondenseSchema>,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const current = await workspace.read(scope, "briefings", artifactId);
  const briefing = current.value.briefing;
  if (!briefing) throw new WorkspaceError("not-found");
  const revisionError = artifactRevisionError(
    current.origin.artifactRevision,
    input.expectedRevision,
  );
  if (revisionError) throw new WorkspaceError(revisionError);
  // [GUARD] Short fields are left alone: condensing them saves nothing and
  // can only lose detail. With nothing long, the pack is returned as it is.
  const material = condenseMaterial(briefing.context);
  if (!material.jobDescription && !material.research) return current;
  const generated = await generateChecked(
    options.generate,
    {
      system: CONDENSE_SYSTEM,
      prompt: JSON.stringify({
        company: briefing.context.company,
        role: briefing.context.role,
        stage: briefing.context.stage,
        budget: {
          jobDescription: condenseBudget(material.jobDescription),
          research: condenseBudget(material.research),
        },
        material,
      }),
    },
    condensedModelSchema,
    scope,
  );
  // Only a result that is really shorter than its original is kept.
  const condensed = shorterMaterial(material, generated);
  log.info("briefing.condensed", {
    artifactId,
    jobDescriptionChars: material.jobDescription.length,
    jobDescriptionCondensed: condensed.jobDescription?.length ?? 0,
    researchChars: material.research.length,
    researchCondensed: condensed.research?.length ?? 0,
  });
  const updated = await workspace.edit(scope, current.origin, {
    briefing: briefingDraftSchema.parse({
      ...briefing,
      context: withCondensedContext(briefing.context, condensed),
    }),
  });
  return updated;
}
