// The live coach: it reads the conversation as it arrives and puts a note in
// front of the person when one would help.
//
// PROBLEM: the person can read a few lines at a glance and no more, while the
// conversation never stops. STRATEGY: one model call at a time, made only
// when something worth a note has been said and the speaker has paused; the
// model may answer with silence; a note is posted as it is written, as
// revisions of one note, so it is on screen within the first sentence.
// COMPLEXITY: O(lines held) per tick; at most LINES_HELD lines are held.
import { createHash } from "node:crypto";
import type { AiEngine, Failure } from "@omnitech/ai-engine";
import type {
  CoachNote,
  CoachNoteInput,
  CoachTranscriptLine,
  CoachTranscriptResponse,
  CoachTranscriptSession,
} from "@omnitech/interview-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { CoachContextPort, CoachFact } from "./context";
import { COACH_SYSTEM, coachPrompt } from "./prompt";
import { parseCoachReply } from "./reply";

export type CoachPorts = {
  engine: Pick<AiEngine, "stream">;
  // The profile that writes the notes (an agent runtime, or a model).
  profileId: string;
  transcript: {
    since(after: number, signal: AbortSignal): Promise<CoachTranscriptResponse>;
  };
  notes: { post(note: CoachNoteInput, signal: AbortSignal): Promise<void> };
  // The person's approved record, for a transcript heard in a live session.
  // Absent: the coach works from the conversation alone.
  context?: CoachContextPort;
  // Who the coach's calls are made as when no live session is behind the
  // transcript; otherwise they are made as that session's owner.
  scope: { tenantId: string; actorId: string };
  nowMs?: () => number;
};

export type CoachOptions = {
  // How long the conversation must pause before the coach reads what is new.
  settleMs?: number;
  // The longest the coach waits for a pause once something worth a note was said.
  maxWaitMs?: number;
  // The least time between two revisions of a note while it is being written.
  postEveryMs?: number;
  // How much the person may say, unprompted, before the coach looks at it.
  candidateWords?: number;
};

export class CoachCallError extends Error {
  constructor(readonly failure: Failure | undefined) {
    super("The coach's call did not finish.");
    this.name = "CoachCallError";
  }
}

const LINES_HELD = 600;
// A backlog (an attached transcript) is read a stretch at a time, so each
// question in it gets its own note at its own moment.
const BATCH_CHARS = 1_500;
const QUESTION_WORDS = 4;
const ATTEMPTS = 2;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// [DOMAIN] Is there something here a note could be about? What the
// interviewer says nearly always is; what the person says is, once they have
// said enough for the coach to steer it. The model still decides.
function worthReading(
  fresh: readonly CoachTranscriptLine[],
  candidateWords: number,
): boolean {
  let theirs = 0;
  for (const line of fresh) {
    if (line.speaker === "candidate") theirs += words(line.text);
    else if (words(line.text) >= QUESTION_WORDS) return true;
  }
  return theirs >= candidateWords;
}

// The next stretch to read: up to BATCH_CHARS, ending where the speaker changes.
function nextBatch(
  fresh: readonly CoachTranscriptLine[],
): CoachTranscriptLine[] {
  const batch: CoachTranscriptLine[] = [];
  let chars = 0;
  for (const line of fresh) {
    const last = batch.at(-1);
    if (last && chars >= BATCH_CHARS && last.speaker !== line.speaker) break;
    batch.push(line);
    chars += line.text.length;
  }
  return batch;
}

export function createCoach(ports: CoachPorts, options: CoachOptions = {}) {
  const {
    settleMs = 1_200,
    maxWaitMs = 6_000,
    postEveryMs = 500,
    candidateWords = 30,
  } = options;
  const now = ports.nowMs ?? Date.now;

  // What the coach holds of one conversation (one transcript epoch).
  let epoch = "";
  let cursor = 0;
  let lines: CoachTranscriptLine[] = [];
  // The last line the model has decided on.
  let readTo = 0;
  let lastArrivalMs = 0;
  let waitingSinceMs: number | null = null;
  let given: Pick<CoachNote, "title" | "ask" | "kind">[] = [];
  // The last revision posted of each note, by its key.
  let revisions = new Map<string, number>();
  let lastAskId: string | undefined;
  let failures = 0;
  // The live session the transcript was last heard in, if any.
  let session: CoachTranscriptSession | undefined;

  const forget = (next: string) => {
    epoch = next;
    cursor = 0;
    lines = [];
    readTo = 0;
    waitingSinceMs = null;
    given = [];
    revisions = new Map();
    lastAskId = undefined;
    failures = 0;
  };

  // One call: the stretch is put to the model and its note is posted as it
  // is written. Returns once the model has finished or said nothing.
  async function coachOn(
    batch: readonly CoachTranscriptLine[],
    signal: AbortSignal,
  ): Promise<void> {
    const until = batch.at(-1) as CoachTranscriptLine;
    // [GUARD] The note is named by the stretch it answers, so a second
    // attempt at the same stretch takes the first one's place in the window
    // instead of leaving its half-written note beside the new one.
    const key = `coach-${epoch.slice(0, 8)}-${until.seq}`;
    let revision = revisions.get(key) ?? 0;
    let posted = "";
    let postedAtMs = 0;
    let text = "";
    // [STRATEGY] The facts are chosen by what is new, with the interviewer's
    // words first: the question decides which part of the record matters.
    const asked = [
      ...batch.filter((line) => line.speaker !== "candidate"),
      ...batch.filter((line) => line.speaker === "candidate"),
    ]
      .map((line) => line.text)
      .join(" ");
    const facts: CoachFact[] =
      session && ports.context
        ? await ports.context.facts(session, asked).catch(() => [])
        : [];
    // Only what is the person's own (their record, what they want) can make
    // a claim theirs; the employer's material never can.
    const known = new Map(
      facts
        .filter((fact) => fact.about !== "employer")
        .map((fact) => [fact.pointer, fact.text]),
    );
    const post = async (final: boolean) => {
      const reply = parseCoachReply(text, final, known);
      if (!reply) return;
      const askId = reply.sameQuestion && lastAskId ? lastAskId : `${key}-ask`;
      const note: CoachNoteInput = {
        ...reply.note,
        askId,
        key,
        // The moment the note is for: when the last line it answers was said.
        at: until.at,
      };
      const shape = JSON.stringify(note);
      if (shape !== posted) {
        revision += 1;
        revisions.set(key, revision);
        await ports.notes.post({ ...note, revision }, signal);
        posted = shape;
        postedAtMs = now();
      }
      // A note is remembered when it is finished, whether or not its last
      // line had already been shown while it was written.
      if (final) {
        lastAskId = askId;
        given = [
          {
            title: reply.note.title,
            kind: reply.note.kind ?? "direct-answer",
            ...(reply.note.ask ? { ask: reply.note.ask } : {}),
          },
          ...given,
        ].slice(0, 20);
      }
    };

    const stream = ports.engine.stream(
      {
        profileId: ports.profileId,
        messages: [
          { role: "system", parts: [{ type: "text", text: COACH_SYSTEM }] },
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: coachPrompt({
                  lines: lines.filter((line) => line.seq <= until.seq),
                  readTo,
                  notes: given,
                  facts,
                }),
              },
            ],
          },
        ],
      },
      {
        scope: {
          ...(session
            ? { tenantId: session.tenantId, actorId: session.actorId }
            : ports.scope),
          productId: INTERVIEW_PRODUCT_ID,
        },
        permissions: ["interview.read"],
        signal,
        // [SAFETY] Only lines of a session that may be processed off the
        // device, or a transcript a person attached, ever reach the coach.
        policy: "permitted-remote",
        idempotencyKey: `coach:${epoch}:${until.seq}:${failures}`,
        for: { kind: "coach", id: epoch },
        traceId: createHash("sha256")
          .update(`coach:${epoch}:${until.seq}`)
          .digest("hex")
          .slice(0, 32),
      },
    );
    for await (const part of stream) {
      if (part.type === "text") {
        text += part.text;
        // The note so far, no more often than the window can usefully redraw.
        if (now() - postedAtMs >= postEveryMs) await post(false);
      } else if (part.type === "done") {
        await post(true);
        return;
      } else if (part.type === "failed") throw new CoachCallError(part.failure);
      else if (part.type === "cancelled") throw new CoachCallError(undefined);
    }
    throw new CoachCallError(undefined);
  }

  return {
    // True when the coach did something and should look again at once.
    async tick(signal: AbortSignal): Promise<boolean> {
      // [GUARD] A cleared transcript (or a restarted Studio) is another
      // conversation: nothing of the last one is carried into it.
      const read = await ports.transcript.since(cursor, signal);
      if (read.epoch !== epoch) {
        const again = cursor > 0;
        forget(read.epoch);
        if (again) return true;
      }
      session = read.session;
      if (read.lines.length > 0) {
        lines = [...lines, ...read.lines].slice(-LINES_HELD);
        cursor = read.cursor;
        lastArrivalMs = now();
      }

      const fresh = lines.filter((line) => line.seq > readTo);
      if (fresh.length === 0 || !worthReading(fresh, candidateWords)) {
        waitingSinceMs = null;
        return false;
      }
      // Wait for the speaker to pause, but never for long: a note that
      // arrives after the answer is no use.
      waitingSinceMs ??= now();
      const paused = now() - lastArrivalMs >= settleMs;
      if (!paused && now() - waitingSinceMs < maxWaitMs) return false;

      const batch = nextBatch(fresh);
      const until = (batch.at(-1) as CoachTranscriptLine).seq;
      try {
        await coachOn(batch, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        failures += 1;
        // A stretch that cannot be answered or shown (the model failed, or
        // Studio refused the note) is passed over, not retried for ever: the
        // conversation has moved on.
        const final =
          error instanceof CoachCallError && error.failure?.retryable === false;
        if (failures < ATTEMPTS && !final) throw error;
      }
      failures = 0;
      readTo = until;
      waitingSinceMs = null;
      return true;
    },
  };
}

export type Coach = ReturnType<typeof createCoach>;
