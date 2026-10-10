import { behaviourFlagInputSchema } from "@omnitech/interview-contracts";
import { COACH_PLAN_LENGTH } from "../coach-plan";
import {
  changeFlag,
  claimWriter,
  listFlags,
  readPlan,
  releaseWriter,
  savePlan,
} from "./services/coach-settings.service";
import {
  type ApiApp,
  apiError,
  JSON_BODY_LIMIT_BYTES,
  readBody,
} from "./transport";

export function mountCoachSettingsRoutes(app: ApiApp) {
  // Who holds the pen: a coach claims it, renews it, and gives it up.
  app.post("/api/v1/coach-writer", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const asked = body.value as {
      id?: unknown;
      takeover?: unknown;
      leaseSeconds?: unknown;
    } | null;
    if (typeof asked?.id !== "string" || !/^[\w.-]{1,64}$/.test(asked.id))
      return apiError(
        context,
        400,
        "invalid_coach_writer",
        "A coach names itself in letters, digits, dots and dashes.",
      );
    const claim = claimWriter(asked.id, asked);
    return claim
      ? context.json(claim)
      : apiError(context, 409, "coach_held", "Another coach holds the notes.");
  });
  app.delete("/api/v1/coach-writer", (context) => {
    releaseWriter(context.req.query("id") ?? "");
    return context.body(null, 204);
  });

  // The plan for the call: written by the person, read by the coach.
  app.get("/api/v1/coach-plan", (context) => context.json(readPlan()));
  app.put("/api/v1/coach-plan", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const text = (body.value as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || text.length > COACH_PLAN_LENGTH)
      return apiError(
        context,
        400,
        "invalid_coach_plan",
        "The plan is text of at most a page.",
      );
    return context.json(savePlan(text));
  });

  // The behaviour flags (BEHAVIOUR_FLAGS in the contracts): read by the
  // Settings pane and by the agent worker, changed from Settings. Each flag
  // says where its value comes from; one the host set in the environment is
  // read-only here. [SAFETY] Names and values from closed lists only.
  app.get("/api/v1/behaviour-flags", (context) =>
    context.json({ flags: listFlags() }),
  );
  app.put("/api/v1/behaviour-flags", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const input = behaviourFlagInputSchema.safeParse(body.value);
    const outcome = input.success
      ? changeFlag(input.data.key, input.data.value)
      : { kind: "invalid" as const };
    if (outcome.kind === "invalid")
      return apiError(
        context,
        400,
        "invalid_behaviour_flag",
        "The change names a flag and one of its values.",
      );
    if (outcome.kind === "environment")
      return apiError(
        context,
        409,
        "flag_set_by_environment",
        "This flag is set by the environment.",
      );
    return context.json({ flags: outcome.flags });
  });
}
