import { randomUUID } from "node:crypto";
import {
  type InterviewPlan,
  type InterviewPlanInput,
  interviewPlanInputSchema,
  type PlanItemInput,
  type PlanItemPatch,
  planItemInputSchema,
  planItemPatchSchema,
} from "@omnitech/interview-contracts";
import {
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  WorkspaceError,
  type WorkspaceScope,
} from "../assistant/workspace";

const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const ids = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

export type StoredPlanItem = {
  id: string;
  kind: PlanItemInput["kind"];
  ref: string | null;
  title: string;
  done: boolean;
  position: number;
};

function plan(row: Record<string, unknown>): InterviewPlan {
  return {
    id: String(row["id"]),
    company: String(row["company"]),
    role: String(row["role"]),
    scheduledAt: row["scheduled_at"] ? iso(row["scheduled_at"]) : null,
    durationMinutes:
      row["duration_minutes"] === null ? null : Number(row["duration_minutes"]),
    format: String(row["format"]),
    topics: (row["topics"] as string[]) ?? [],
    updatedAt: iso(row["updated_at"]),
  };
}
function item(row: Record<string, unknown>): StoredPlanItem {
  return {
    id: String(row["id"]),
    kind: row["kind"] as StoredPlanItem["kind"],
    ref: row["ref"] === null ? null : String(row["ref"]),
    title: String(row["title"]),
    done: Boolean(row["done"]),
    position: Number(row["position"]),
  };
}

// A person's interviews and the plan for each, private to them.
export class InterviewPlanRepository {
  private readonly workspace: InterviewWorkspaceRepository;
  constructor(database: WorkspaceDatabasePort) {
    this.workspace = new InterviewWorkspaceRepository(database);
  }

  // The interview to prepare for: the next one still ahead (or today's),
  // else the one most recently edited.
  current(scope: WorkspaceScope): Promise<InterviewPlan | null> {
    return this.workspace.transaction(scope, async (tx) => {
      const [row] = await tx.query(
        `SELECT * FROM interview.interview_plans WHERE ${scoped} ORDER BY (scheduled_at >= now() - interval '1 day') DESC NULLS LAST, CASE WHEN scheduled_at >= now() - interval '1 day' THEN scheduled_at END ASC, updated_at DESC LIMIT 1`,
        ids(scope),
      );
      return row ? plan(row) : null;
    });
  }

  // [GUARD] Creates when there is no id yet; an unknown id is not found.
  save(
    scope: WorkspaceScope,
    planId: string | null,
    input: InterviewPlanInput,
  ): Promise<InterviewPlan> {
    const value = interviewPlanInputSchema.parse(input);
    const columns = [
      value.company,
      value.role,
      value.scheduledAt,
      value.durationMinutes,
      value.format,
      JSON.stringify(value.topics),
    ];
    return this.workspace.transaction(scope, async (tx) => {
      const [row] = planId
        ? await tx.query(
            `UPDATE interview.interview_plans SET company=$5,role=$6,scheduled_at=$7,duration_minutes=$8,format=$9,topics=$10::jsonb,updated_at=now() WHERE ${scoped} AND id=$4 RETURNING *`,
            [...ids(scope), planId, ...columns],
          )
        : await tx.query(
            "INSERT INTO interview.interview_plans(tenant_id,actor_id,product_id,id,company,role,scheduled_at,duration_minutes,format,topics) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *",
            [...ids(scope), randomUUID(), ...columns],
          );
      if (!row) throw new WorkspaceError("not-found");
      return plan(row);
    });
  }

  items(scope: WorkspaceScope, planId: string): Promise<StoredPlanItem[]> {
    return this.workspace.transaction(scope, async (tx) =>
      (
        await tx.query(
          `SELECT * FROM interview.interview_plan_items WHERE ${scoped} AND plan_id=$4 ORDER BY position, created_at, id`,
          [...ids(scope), planId],
        )
      ).map(item),
    );
  }

  // New items go to the end of the plan.
  addItem(
    scope: WorkspaceScope,
    planId: string,
    input: PlanItemInput,
  ): Promise<StoredPlanItem> {
    const value = planItemInputSchema.parse(input);
    return this.workspace.transaction(scope, async (tx) => {
      const [owner] = await tx.query(
        `SELECT id FROM interview.interview_plans WHERE ${scoped} AND id=$4`,
        [...ids(scope), planId],
      );
      if (!owner) throw new WorkspaceError("not-found");
      const [row] = await tx.query(
        `INSERT INTO interview.interview_plan_items(tenant_id,actor_id,product_id,id,plan_id,kind,ref,title,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(position)+1,0) FROM interview.interview_plan_items WHERE ${scoped} AND plan_id=$5)) RETURNING *`,
        [
          ...ids(scope),
          randomUUID(),
          planId,
          value.kind,
          value.ref,
          value.title,
        ],
      );
      return item(row!);
    });
  }

  updateItem(
    scope: WorkspaceScope,
    itemId: string,
    patch: PlanItemPatch,
  ): Promise<StoredPlanItem> {
    const value = planItemPatchSchema.parse(patch);
    return this.workspace.transaction(scope, async (tx) => {
      const [row] = await tx.query(
        `UPDATE interview.interview_plan_items SET title=COALESCE($5,title),done=COALESCE($6,done) WHERE ${scoped} AND id=$4 RETURNING *`,
        [...ids(scope), itemId, value.title ?? null, value.done ?? null],
      );
      if (!row) throw new WorkspaceError("not-found");
      return item(row);
    });
  }

  removeItem(scope: WorkspaceScope, itemId: string): Promise<void> {
    return this.workspace.transaction(scope, async (tx) => {
      const rows = await tx.query(
        `DELETE FROM interview.interview_plan_items WHERE ${scoped} AND id=$4 RETURNING id`,
        [...ids(scope), itemId],
      );
      if (!rows.length) throw new WorkspaceError("not-found");
    });
  }
}
