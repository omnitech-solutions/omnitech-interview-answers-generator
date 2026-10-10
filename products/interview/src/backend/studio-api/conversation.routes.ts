import {
  coachActivityInputSchema,
  coachTranscriptInputSchema,
} from "@omnitech/interview-contracts";
import {
  appendTranscript,
  clearTranscript,
  keepLedger,
  readLedger,
  readTranscript,
  setActivity,
} from "./services/conversation.service";
import {
  type ApiApp,
  apiError,
  COACH_LEDGER_LIMIT_BYTES,
  JSON_BODY_LIMIT_BYTES,
  readBody,
} from "./transport";

export function mountCoachLedgerRoutes(app: ApiApp) {
  // The coach's ledger of the conversation in hand: kept by the coach, held
  // here with the transcript, so a restarted coach does not start again.
  app.get("/api/v1/coach-ledger", (context) => {
    const kept = readLedger(context.req.query("epoch") ?? "");
    return kept === undefined
      ? context.body(null, 204)
      : context.json({ ledger: kept });
  });
  app.put("/api/v1/coach-ledger", async (context) => {
    const body = await readBody(context, COACH_LEDGER_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const kept = (body.value as { ledger?: { epoch?: unknown } } | null)
      ?.ledger;
    if (
      typeof kept !== "object" ||
      kept === null ||
      typeof kept.epoch !== "string"
    )
      return apiError(
        context,
        400,
        "invalid_coach_ledger",
        "A ledger names the conversation it is of.",
      );
    // A ledger of a conversation that is over is not kept.
    return keepLedger(kept.epoch, kept)
      ? context.body(null, 204)
      : apiError(
          context,
          409,
          "stale_conversation",
          "The conversation this ledger is of is over.",
        );
  });
}

export function mountCoachTranscriptRoutes(app: ApiApp) {
  // The coach's transcript: read by the coach, written by a live session (as
  // it hears) or by a person attaching one. Held in memory only.
  app.get("/api/v1/coach-transcript", (context) => {
    return context.json(readTranscript(context.req.query("after")));
  });
  app.post("/api/v1/coach-transcript", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = coachTranscriptInputSchema.safeParse(body.value);
    // [SAFETY] The issue paths only: what was said never goes into an error.
    if (!parsed.success)
      return apiError(
        context,
        400,
        "invalid_coach_transcript",
        "The transcript is invalid.",
        parsed.error.issues.slice(0, 20).map((issue) => issue.path.join(".")),
      );
    return context.json(appendTranscript(parsed.data.lines), 201);
  });
  // Who is speaking, from whoever can tell (an audio source's voice activity).
  app.post("/api/v1/coach-activity", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = coachActivityInputSchema.safeParse(body.value);
    if (!parsed.success)
      return apiError(
        context,
        400,
        "invalid_coach_activity",
        "The activity is invalid.",
      );
    setActivity(parsed.data);
    return context.body(null, 204);
  });
  app.delete("/api/v1/coach-transcript", (context) =>
    context.json(clearTranscript()),
  );
}
