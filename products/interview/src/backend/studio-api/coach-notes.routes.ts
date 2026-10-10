import { coachNoteInputSchema } from "@omnitech/interview-contracts";
import { CONVERSATION_HEADER, WRITER_HEADER } from "../coach-writer";
import { notesSpace } from "./domain/conversation";
import { addNote, clearNotes, readNotes } from "./services/coach-notes.service";
import {
  type ApiApp,
  apiError,
  JSON_BODY_LIMIT_BYTES,
  readBody,
} from "./transport";

export function mountCoachNoteRoutes(app: ApiApp) {
  // Coach notes for the live window: read by the page, written by a coach.
  // A reader that names the revision it already shows is answered with no
  // content while nothing has changed, so it can ask often (a note grows on
  // screen as its coach writes it) at almost no cost.
  // `?space=replay` reads and writes the notes of a replay, which are kept
  // apart from the person's own.
  app.get("/api/v1/coach-notes", (context) => {
    const held = readNotes(
      notesSpace(context.req.query("space")),
      context.req.query("revision"),
    );
    return held === null ? context.body(null, 204) : context.json(held);
  });
  app.post("/api/v1/coach-notes", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = coachNoteInputSchema.safeParse(body.value);
    // [SAFETY] The issue paths only: a note's text never goes into an error.
    if (!parsed.success)
      return apiError(
        context,
        400,
        "invalid_coach_note",
        "The coach note is invalid.",
        parsed.error.issues.map((issue) => issue.path.join(".")),
      );
    // [SAFETY] A note is checked against who holds the pen and against the
    // conversation it was written from, here, where both are known: a coach
    // that was replaced, or one still writing about a conversation that has
    // been cleared, cannot put a note on screen however late it arrives.
    const outcome = addNote(
      notesSpace(context.req.query("space")),
      parsed.data,
      context.req.header(WRITER_HEADER),
      context.req.header(CONVERSATION_HEADER),
    );
    if (outcome.kind === "stale_writer")
      return apiError(
        context,
        409,
        "stale_writer",
        "Another coach holds the notes.",
      );
    if (outcome.kind === "stale_conversation")
      return apiError(
        context,
        409,
        "stale_conversation",
        "The conversation this note was written from is over.",
      );
    // An older revision of a note already held: refused, nothing changed.
    if (outcome.kind === "stale_coach_note")
      return apiError(
        context,
        409,
        "stale_coach_note",
        "A newer revision of this note is already held.",
      );
    return context.json(outcome.notes, 201);
  });
  // Clearing the notes clears what the coach read to write them.
  app.delete("/api/v1/coach-notes", (context) => {
    // Only the conversation those notes were written from is cleared with
    // them: closing a replay leaves a live session's transcript alone.
    return context.json(clearNotes(notesSpace(context.req.query("space"))));
  });
}
