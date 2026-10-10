import type {
  PlanItem,
  PlanItemInput,
  PlanItemStatus,
  PlanResponse,
} from "@omnitech/interview-contracts";
import {
  type InterviewWorkspaceRepository,
  WorkspaceError,
  type WorkspaceScope,
} from "../../assistant/workspace";
import type { BriefingRepository } from "../../briefing/repository";
import { briefingStatus, questionStatus } from "../domain/status";
import type { InterviewPlanRepository, StoredPlanItem } from "../repository";

// The plan's use cases: the current interview, its items and each item's
// live status, read from where each kind of item lives.
export type PlanDependencies = {
  plans: InterviewPlanRepository;
  drafts: Pick<InterviewWorkspaceRepository, "listDrafts">;
  briefings: Pick<BriefingRepository, "listArtifacts">;
  // The workspace whose drafts are the person's coding questions.
  questionsWorkspace: string;
  // Status for rehearsal items, when rehearsals are recorded.
  rehearsalStatus?:
    | ((
        scope: WorkspaceScope,
        ref: string | null,
      ) => Promise<PlanItemStatus | null>)
    | undefined;
};

// Only the kinds the plan holds are read.
async function withStatus(
  plan: PlanDependencies,
  scope: WorkspaceScope,
  items: StoredPlanItem[],
): Promise<PlanItem[]> {
  const needs = (kind: StoredPlanItem["kind"]) =>
    items.some((entry) => entry.kind === kind);
  const [questions, savedBriefings] = await Promise.all([
    needs("question")
      ? plan.drafts.listDrafts(scope, plan.questionsWorkspace)
      : [],
    needs("briefing") ? plan.briefings.listArtifacts(scope) : [],
  ]);
  return Promise.all(
    items.map(async (entry): Promise<PlanItem> => {
      let status: PlanItemStatus | null = null;
      if (entry.kind === "question")
        status = questionStatus(
          questions.find((draft) => draft.artifactId === entry.ref),
        );
      else if (entry.kind === "briefing")
        status = briefingStatus(
          savedBriefings.find((item) => item.id === entry.ref),
        );
      else if (entry.kind === "rehearsal")
        status = (await plan.rehearsalStatus?.(scope, entry.ref)) ?? null;
      return { ...entry, status };
    }),
  );
}

export async function currentPlan(
  plan: PlanDependencies,
  scope: WorkspaceScope,
): Promise<PlanResponse> {
  const interview = await plan.plans.current(scope);
  return {
    interview,
    items: interview
      ? await withStatus(
          plan,
          scope,
          await plan.plans.items(scope, interview.id),
        )
      : [],
  };
}

// New items go to the interview being prepared for; without one, not found
// (decided before the request's body is read).
export async function addItemToCurrentPlan(
  plan: PlanDependencies,
  scope: WorkspaceScope,
  input: () => Promise<PlanItemInput>,
): Promise<void> {
  const interview = await plan.plans.current(scope);
  if (!interview) throw new WorkspaceError("not-found");
  await plan.plans.addItem(scope, interview.id, await input());
}
