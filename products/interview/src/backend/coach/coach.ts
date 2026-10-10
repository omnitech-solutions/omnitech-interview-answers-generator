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
  CoachNoteInput,
  CoachSpace,
  CoachTranscriptLine,
  CoachTranscriptResponse,
  CoachTranscriptSession,
} from "@omnitech/interview-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { CoachContextPort, CoachFact } from "./context";
import {
  type CoachGrounding,
  coachPromptParts,
  coachSystem,
  type GivenNote as Given,
} from "./prompt";
import {
  type CiteCheck,
  COACH_MODES,
  type CoachMode,
  coachLogOf,
  type DesignEdge,
  designDiagram,
  parseCoachReply,
} from "./reply";
import { rosterOf } from "./roster";
import {
  type ActReason,
  decide,
  type Speaking,
  shouldRecall,
  type TurnTiming,
  turnsOf,
  voicesIn,
} from "./turns";

export type CoachPorts = {
  engine: Pick<AiEngine, "stream">;
  // The profile that writes the notes (an agent runtime, or a model).
  profileId: string;
  transcript: {
    since(after: number, signal: AbortSignal): Promise<CoachTranscriptResponse>;
  };
  notes: {
    // `space` says whose notes these are: the person's own ("live"), or a
    // replay's, which are kept apart.
    // `conversation` is the transcript epoch the note was written from, so
    // whoever takes the note can refuse one about a conversation that is over.
    post(
      note: CoachNoteInput,
      signal: AbortSignal,
      space?: CoachSpace,
      conversation?: string,
    ): Promise<void>;
  };
  // The person's approved record, for a transcript heard in a live session.
  // Absent: the coach works from the conversation alone.
  context?: CoachContextPort;
  // Who the coach's calls are made as when no live session is behind the
  // transcript; otherwise they are made as that session's owner.
  scope: { tenantId: string; actorId: string };
  // Where the coach keeps what it knows of the conversation, so a coach that
  // is restarted mid-call takes up where the last one stopped instead of
  // coaching every question again. Absent: it starts from nothing.
  ledger?: {
    load(epoch: string): Promise<CoachLedger | undefined>;
    save(ledger: CoachLedger): Promise<void>;
  };
  // The plan for this call, as the person wrote it. Read again now and then,
  // so an edit made during the call is used. Absent: there is none.
  plan?: () => Promise<string | undefined>;
  nowMs?: () => number;
  // Told each thing the coach does. Absent: nobody is told.
  onEvent?: (event: CoachEvent) => void;
};

export type CoachOptions = {
  // When the coach acts (turns.ts): the pauses it waits for and how often it
  // looks at the candidate's own answer.
  timing?: Partial<TurnTiming>;
  // The least time between two revisions of a note while it is being written.
  postEveryMs?: number;
  // [DOMAIN] Keep one session of the model open for the call, where the
  // engine's provider can (an agent runtime): the model then remembers the
  // conversation and its own notes, and each turn sends only what is new.
  // Without it every call is put to a model that starts from nothing.
  retain?: boolean;
  // How closely a note is held to what the coach was given (prompt.ts):
  // "strict" tells the person's own notes apart and adds the grounding rules.
  grounding?: CoachGrounding;
  // How a claim that cites a fact is checked before it is marked verified
  // (reply.ts): "words" also asks that the cited fact says the claim.
  cite?: CiteCheck;
};

// What the coach did and why, for whoever watches it work (a replay, a log).
// [SAFETY] Ids, counts and reasons only: never what was said.
export type CoachEvent = {
  atMs: number;
  what: "act" | "recall" | "note" | "silent" | "failed";
  reason?: ActReason;
  // The stretch: the first and last line read.
  from: number;
  until: number;
  key: string;
  // For "note": the revision posted, and whether it is the last.
  revision?: number;
  final?: boolean;
};

// [DOMAIN] What a coach knows of one conversation beyond the transcript
// itself: how far it has read, what it has already told the person, what it
// chose to remember, and the design it is drawing. It is the coach's memory,
// kept outside the coach so that the process running it can be replaced. The
// model session is not in it: that is rebuilt from this, never the reverse.
export const COACH_LEDGER_VERSION = 1;
export type CoachLedger = {
  version: typeof COACH_LEDGER_VERSION;
  // The conversation it is the ledger of.
  epoch: string;
  readTo: number;
  given: GivenNote[];
  log: string[];
  cautions: { key: string; text: string }[];
  design: {
    stage?: string;
    edges: DesignEdge[];
    sections?: CoachNoteInput["sections"];
  };
  lastAskId?: string;
  // The last revision posted of each note, so a revision never goes back.
  revisions: [string, number][];
  looks: number;
  nudged: boolean;
};

export class CoachCallError extends Error {
  constructor(readonly failure: Failure | undefined) {
    super("The coach's call did not finish.");
    this.name = "CoachCallError";
  }
}

const LINES_HELD = 600;
const ATTEMPTS = 2;
// The most a voice's stop may precede the arrival of its words (a
// recogniser's delay) and still be read as their end.
const STOP_BEFORE_TEXT_MS = 2_000;
// A retained session is begun anew after this many calls.
const ROTATE_AFTER = 12;
// How long after answering a turn a further sentence from the interviewer
// still counts as the same question.
const SAME_TURN_MS = 20_000;
// The most looks the coach takes at one answer in progress.
const ANSWER_LOOKS = 2;
// A changed screen is looked at once nothing has been said for this long,
// and no sooner than this after the coach last acted.
const SCREEN_QUIET_MS = 1_500;
const SCREEN_EVERY_MS = 15_000;
const PLAN_HELD_MS = 60_000;
// The most lines of its own log the coach carries.
const LOG_HELD = 30;
// The most facts of the person's record held for one conversation.
const FACTS_HELD = 400;
// The most times one turn's call is made again because the interviewer went
// on: after that the call in hand is left to finish.
const RECALLS = 2;

type GivenNote = Given & { key?: string };

const CAUTIONS_HELD = 12;
const lineText = (
  line: NonNullable<CoachNoteInput["sections"]>[number]["lines"][number],
) => line.segments.map((segment) => segment.text).join("");
const cautionsOf = (note: CoachNoteInput): string[] =>
  (note.sections ?? [])
    .filter((section) => section.kind === "caution")
    .flatMap((section) => section.lines.map(lineText));
// Two warnings say the same thing when most of the words that carry one are
// in the other.
const carrying = (text: string) =>
  new Set(text.toLowerCase().match(/[a-z0-9.#+]{4,}/g) ?? []);
function repeats(caution: string, earlier: readonly string[]): boolean {
  const words = carrying(caution);
  if (words.size === 0) return false;
  return earlier.some((given) => {
    const held = carrying(given);
    let shared = 0;
    for (const word of words) if (held.has(word)) shared += 1;
    return shared / Math.min(words.size, held.size || 1) >= 0.6;
  });
}
function withoutRepeats(
  note: CoachNoteInput,
  earlier: readonly string[],
): CoachNoteInput {
  return {
    ...note,
    sections: (note.sections ?? []).flatMap((section) => {
      if (section.kind !== "caution") return [section];
      const lines = section.lines.filter(
        (line) => !repeats(lineText(line), earlier),
      );
      return lines.length > 0 ? [{ ...section, lines }] : [];
    }),
  };
}

// What the interviewer said in a stretch, to tell an echo of it by.
const turnText = (
  lines: readonly CoachTranscriptLine[],
  from: number,
  until: number,
) =>
  lines
    .filter(
      (line) =>
        line.seq >= from && line.seq <= until && line.speaker !== "candidate",
    )
    .map((line) => line.text)
    .join(" ");

// The kind of round, as the plan's first line says it ("mode: system-design").
// A plan that does not say is a conversation.
function modeOf(plan: string | undefined): CoachMode {
  const said = /^\s*mode:\s*([a-z-]+)/i.exec(plan ?? "")?.[1]?.toLowerCase();
  return COACH_MODES.find((mode) => mode === said) ?? "conversation";
}

// The arrows drawn so far with the new ones, each once, the oldest first.
const EDGES_HELD = 40;
function withEdges(
  held: readonly DesignEdge[],
  added: readonly DesignEdge[],
): DesignEdge[] {
  const same = (a: DesignEdge, b: DesignEdge) =>
    a.from.toLowerCase() === b.from.toLowerCase() &&
    a.to.toLowerCase() === b.to.toLowerCase();
  return [
    ...held,
    ...added.filter((edge) => !held.some((each) => same(each, edge))),
  ].slice(0, EDGES_HELD);
}

// What a note said, in a line, for the coach's own memory of it.
function saidOf(note: CoachNoteInput): string {
  const text = (note.sections ?? [])
    .flatMap((section) =>
      section.lines.map((line) =>
        line.segments.map((segment) => segment.text).join(""),
      ),
    )
    .join(" / ");
  return text.length <= 280 ? text : `${text.slice(0, 279)}…`;
}

// The first line of a note and nothing else, as a follow-up to its question.
function oneLine(note: CoachNoteInput): CoachNoteInput {
  const section = (note.sections ?? [])[0];
  const line = section?.lines[0];
  return {
    ...note,
    kind: "follow-up",
    sections: section && line ? [{ ...section, lines: [line] }] : [],
  };
}

// A call in hand: the stretch it reads, why, and how it ended.
type Call = {
  from: number;
  until: number;
  key: string;
  reason: ActReason;
  about: "interviewer" | "candidate";
  recalls: number;
  stop: AbortController;
  // Settles when the call has: with its error, if it failed.
  done: Promise<{ error?: unknown }>;
  settled: boolean;
  error?: unknown;
};

export function createCoach(ports: CoachPorts, options: CoachOptions = {}) {
  const {
    postEveryMs = 500,
    timing,
    retain = false,
    grounding = "plain",
    cite = "pointer",
  } = options;
  const now = ports.nowMs ?? Date.now;
  const tell = (event: Omit<CoachEvent, "atMs">) =>
    ports.onEvent?.({ atMs: now(), ...event });

  // What the coach holds of one conversation (one transcript epoch).
  let epoch = "";
  let cursor = 0;
  let lines: CoachTranscriptLine[] = [];
  // The last line the model has decided on.
  let readTo = 0;
  let lastArrivalMs = 0;
  // When the coach last began a call: it does not look at the candidate's
  // answer again too soon after.
  let lastActMs = Number.NEGATIVE_INFINITY;
  // The call in hand, if any. One at a time.
  let running: Call | undefined;
  let given: GivenNote[] = [];
  // The interviewer's turn last answered: a sentence they add before the
  // candidate speaks belongs to it, and its note is revised in place.
  let lastTurn: { from: number; key: string; atMs: number } | undefined;
  // A system design in progress: its stage and the arrows drawn so far. One
  // note holds the whole design and is revised as it grows.
  let design: {
    stage?: string;
    edges: DesignEdge[];
    sections?: CoachNoteInput["sections"];
  } = { edges: [] };
  // Who is speaking right now, where the feed can tell.
  let speaking: Speaking | undefined;
  // When the interviewer's voice last stopped, where the feed says.
  let interviewerStoppedMs: number | undefined;
  // Whose conversation this is, and so where its notes go.
  let space: CoachSpace = "live";
  // What is on the shared screen, and whether the coach has looked at it.
  let screen: { text: string; seen: boolean } | undefined;
  // The warnings given so far in this call, so none is given twice.
  let cautions: { key: string; text: string }[] = [];
  // Looks at, and nudges during, the answer to the current question.
  let looks = 0;
  let nudged = false;
  // The last revision posted of each note, by its key.
  let revisions = new Map<string, number>();
  let lastAskId: string | undefined;
  let failures = 0;
  // How many calls this coach has made in the conversation.
  let calls = 0;
  // What the coach has chosen to remember of this call (reply.ts, LOG lines).
  let log: string[] = [];
  let plan: { text: string | undefined; atMs: number } | undefined;
  // How many more times the next call may be made again for its turn.
  let recallsLeft = RECALLS;
  // The live session the transcript was last heard in, if any.
  let session: CoachTranscriptSession | undefined;
  // The person's facts given so far in this conversation, by pointer, the
  // latest last (see `known` in coachOn).
  let factsGiven = new Map<string, string>();

  const forget = (next: string) => {
    epoch = next;
    cursor = 0;
    lines = [];
    readTo = 0;
    lastActMs = Number.NEGATIVE_INFINITY;
    running?.stop.abort();
    running = undefined;
    given = [];
    lastTurn = undefined;
    design = { edges: [] };
    screen = undefined;
    recallsLeft = RECALLS;
    cautions = [];
    looks = 0;
    nudged = false;
    log = [];
    revisions = new Map();
    lastAskId = undefined;
    failures = 0;
    calls = 0;
    factsGiven = new Map();
  };

  const ledgerOf = (): CoachLedger => ({
    version: COACH_LEDGER_VERSION,
    epoch,
    readTo,
    given,
    log,
    cautions,
    design,
    ...(lastAskId ? { lastAskId } : {}),
    revisions: [...revisions],
    looks,
    nudged,
  });
  // Kept after everything that changes it. [SAFETY] A ledger that cannot be
  // kept costs the saving, never the coaching.
  const keep = () => {
    try {
      void ports.ledger?.save(ledgerOf()).catch(() => undefined);
    } catch {
      // A ledger that cannot even be asked is the same as one that fails.
    }
  };
  // Takes up a conversation another coach had begun. A ledger of another
  // shape, or one that says it read further than the transcript goes, is not
  // trusted: the coach then starts from nothing.
  async function restore(heardTo: number): Promise<void> {
    let kept: CoachLedger | undefined;
    try {
      kept = await ports.ledger?.load(epoch);
    } catch {
      return;
    }
    // [GUARD] What the ledger says was read must be in what was heard: one
    // that read further than the transcript goes is of something else, and
    // none of it is taken.
    if (
      !kept ||
      kept.version !== COACH_LEDGER_VERSION ||
      kept.epoch !== epoch ||
      !Number.isInteger(kept.readTo) ||
      kept.readTo < 0 ||
      kept.readTo > heardTo
    )
      return;
    readTo = kept.readTo;
    given = kept.given ?? [];
    log = kept.log ?? [];
    cautions = kept.cautions ?? [];
    design = kept.design ?? { edges: [] };
    lastAskId = kept.lastAskId;
    revisions = new Map(kept.revisions ?? []);
    looks = kept.looks ?? 0;
    nudged = kept.nudged ?? false;
  }

  // One call: the stretch is put to the model and its note is posted as it
  // is written. Returns once the model has finished or said nothing.
  async function coachOn(
    batch: readonly CoachTranscriptLine[],
    key: string,
    // Where the turn this call answers began (earlier than the stretch, when
    // the interviewer added to a turn already answered).
    from: number,
    reason: ActReason,
    signal: AbortSignal,
  ): Promise<void> {
    const until = batch.at(-1) as CoachTranscriptLine;
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
    // [SAFETY] Nor can the person's own notes: what they prepared to say, or
    // said before, is theirs to say and is not their approved record.
    const own = facts.filter(
      (fact) => fact.about === "candidate" || fact.about === "preference",
    );
    // [DOMAIN] A model kept in one session for the call still holds the facts
    // of its earlier turns, and cites them: "the 212 clinics" two questions
    // after the fact was given is the record's, not an invention. So, where
    // a cited claim must also be said by its fact (`cite: "words"`), the
    // facts given earlier in this conversation verify too, this turn's
    // first. Under the pointer-only check they do not: a pointer alone, on
    // any words, against everything given all call, would verify too much.
    if (cite === "words") {
      for (const fact of own) factsGiven.delete(fact.pointer);
      for (const fact of own) factsGiven.set(fact.pointer, fact.text);
      while (factsGiven.size > FACTS_HELD)
        factsGiven.delete(factsGiven.keys().next().value as string);
    }
    const known =
      cite === "words"
        ? new Map([...factsGiven].reverse())
        : new Map(own.map((fact) => [fact.pointer, fact.text]));
    // The plan is read once a minute at most; a plan that cannot be read is
    // no plan, never a failed call.
    if (ports.plan && (!plan || now() - plan.atMs > PLAN_HELD_MS))
      plan = {
        text: await ports.plan().catch(() => plan?.text),
        atMs: now(),
      };
    const callPlan = plan?.text;
    const mode = modeOf(callPlan);
    // [DOMAIN] A design is one note from its first question to its last
    // failure mode, so the drawing is always in one place.
    const designing = mode === "system-design";
    const noteKey = designing ? `coach-${epoch.slice(0, 8)}-design` : key;
    revision = revisions.get(noteKey) ?? 0;
    // [SAFETY] Who a note may say asked. Where the lines of the turn name
    // their speakers, only someone who spoke in it; where they do not (a call
    // heard live), only someone on the plan's roster. A look at the
    // candidate's own answer, or at the screen, was asked by nobody.
    // One name is no panel: the call then reads as any two-person call.
    const listed = rosterOf(callPlan);
    const roster = listed.length > 1 ? listed : [];
    const asking = reason !== "answer-check" && reason !== "screen-change";
    const inTurn = voicesIn(
      lines.filter((line) => line.seq >= from && line.seq <= until.seq),
    );
    const voices = !asking
      ? []
      : inTurn.length > 0
        ? inTurn
        : roster.map((panelist) => panelist.name);
    const post = async (final: boolean) => {
      const parsed = parseCoachReply(text, final, known, mode, voices, cite);
      if (!parsed) return;
      const edges = designing ? withEdges(design.edges, parsed.draw) : [];
      const diagram = designDiagram(edges);
      // [DOMAIN] A look at an answer in progress is a nudge, never a second
      // answer: one line, filed under the question being answered.
      const nudge = reason === "answer-check" && !designing;
      // [GUARD] A warning already given is not given again, whatever the
      // model writes: the third "say NestJS, not Next.js" is noise.
      const fresh = withoutRepeats(
        parsed.note,
        // A note revised in place may keep its own warning.
        cautions
          .filter((each) => each.key !== noteKey)
          .map((each) => each.text),
      );
      if ((fresh.sections ?? []).length === 0 && !diagram) return;
      // A design reply that only adds arrows leaves the note's words as
      // they were: the drawing grew, what to say has not changed.
      const worded =
        designing && (fresh.sections ?? []).length === 0 && design.sections
          ? { ...fresh, sections: design.sections }
          : fresh;
      // A turn in which one named interviewer spoke was asked by them: the
      // source says so, whether or not the model wrote it down.
      const asker =
        worded.from ?? (asking && inTurn.length === 1 ? inTurn[0] : undefined);
      const reply = {
        ...parsed,
        note: nudge
          ? oneLine(worded)
          : asker
            ? { ...worded, from: asker }
            : worded,
      };
      const askId = designing
        ? `${noteKey}-ask`
        : (nudge || reply.sameQuestion) && lastAskId
          ? lastAskId
          : `${key}-ask`;
      const note: CoachNoteInput = {
        ...reply.note,
        ...(designing ? { kind: "technical" as const } : {}),
        ...(diagram ? { diagram } : {}),
        askId,
        key: noteKey,
        // The moment the note is for: when the last line it answers was said.
        at: until.at,
      };
      const shape = JSON.stringify(note);
      if (shape !== posted) {
        revision += 1;
        revisions.set(noteKey, revision);
        await ports.notes.post({ ...note, revision }, signal, space, epoch);
        // Kept at once: a coach that takes over mid-note must go on from
        // this revision, or its note would be refused as an older one.
        keep();
        posted = shape;
        postedAtMs = now();
        tell({
          what: "note",
          reason,
          from,
          until: until.seq,
          key,
          revision,
          final,
        });
      } else if (final && posted !== "")
        // The last line had already been shown while it was written: the
        // note is finished all the same, and whoever watches is told so.
        tell({
          what: "note",
          reason,
          from,
          until: until.seq,
          key,
          revision,
          final: true,
        });
      // A note is remembered when it is finished, whether or not its last
      // line had already been shown while it was written.
      if (final) {
        lastAskId = askId;
        if (nudge) nudged = true;
        cautions = [
          ...cautions.filter((each) => each.key !== noteKey),
          ...cautionsOf(reply.note).map((text) => ({ key: noteKey, text })),
        ].slice(-CAUTIONS_HELD);
        if (designing)
          design = {
            edges,
            ...((reply.note.sections ?? []).length > 0
              ? { sections: reply.note.sections }
              : {}),
            ...(parsed.stage
              ? { stage: parsed.stage }
              : design.stage
                ? { stage: design.stage }
                : {}),
          };
        given = [
          {
            key: noteKey,
            title: reply.note.title,
            kind: reply.note.kind ?? "direct-answer",
            ...(reply.note.ask ? { ask: reply.note.ask } : {}),
            said: saidOf(reply.note),
          },
          // A note revised in place is remembered once, as it now reads.
          ...given.filter((note) => note.key !== noteKey),
        ].slice(0, 20);
      }
    };

    const prompt = coachPromptParts({
      lines: lines.filter((line) => line.seq <= until.seq),
      readTo,
      notes: given,
      facts,
      reason,
      ...(callPlan ? { plan: callPlan } : {}),
      log,
      mode,
      ...(designing ? { design } : {}),
      ...(screen ? { screen: screen.text } : {}),
      ...(roster.length > 0 ? { roster } : {}),
      grounding,
    });
    // One session per conversation, begun again every so often so that it
    // does not grow without bound: the background then says where things are.
    calls += 1;
    const stream = ports.engine.stream(
      {
        profileId: ports.profileId,
        messages: [
          {
            role: "system",
            parts: [{ type: "text", text: coachSystem(grounding) }],
          },
          ...(retain
            ? [
                {
                  role: "user" as const,
                  parts: [{ type: "text" as const, text: prompt.background }],
                },
                {
                  role: "user" as const,
                  parts: [{ type: "text" as const, text: prompt.turn }],
                },
              ]
            : [
                {
                  role: "user" as const,
                  parts: [{ type: "text" as const, text: prompt.whole }],
                },
              ]),
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
        ...(retain
          ? {
              conversation: {
                id: `coach:${epoch}:${Math.floor((calls - 1) / ROTATE_AFTER)}`,
              },
            }
          : {}),
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
        // Remembered once, in the order written; the oldest fall away.
        for (const line of coachLogOf(text))
          if (!log.includes(line)) log = [...log, line].slice(-LOG_HELD);
        if (posted === "")
          tell({ what: "silent", reason, from, until: until.seq, key });
        return;
      } else if (part.type === "failed") throw new CoachCallError(part.failure);
      else if (part.type === "cancelled") throw new CoachCallError(undefined);
    }
    throw new CoachCallError(undefined);
  }

  // Begins a call beside the listening: the coach goes on hearing while the
  // note is written.
  function start(
    batch: readonly CoachTranscriptLine[],
    stretch: { from: number; key: string; until: number },
    why: { reason: ActReason; about: "interviewer" | "candidate" },
    signal: AbortSignal,
  ): true {
    const { from, key, until } = stretch;
    const stop = new AbortController();
    const forward = () => stop.abort();
    signal.addEventListener("abort", forward, { once: true });
    const call: Call = {
      from,
      until,
      key,
      reason: why.reason,
      about: why.about,
      recalls: RECALLS - recallsLeft,
      stop,
      settled: false,
      done: Promise.resolve({}),
    };
    recallsLeft = RECALLS;
    lastActMs = now();
    tell({ what: "act", reason: why.reason, from, until, key });
    call.done = coachOn(batch, key, from, why.reason, stop.signal)
      .then(
        () => ({}),
        (error: unknown) => ({ error }),
      )
      .then((outcome) => {
        signal.removeEventListener("abort", forward);
        // A call stopped on purpose (made again) is not a failure.
        if (!stop.signal.aborted || signal.aborted)
          call.error = (outcome as { error?: unknown }).error;
        call.settled = true;
        return outcome;
      });
    running = call;
    return true;
  }

  return {
    // True when the coach did something and should look again at once.
    // [STRATEGY] A call runs beside the listening, never instead of it: the
    // coach keeps hearing while a note is written, so it can tell that the
    // interviewer went on and the question it is answering was not whole.
    async tick(signal: AbortSignal): Promise<boolean> {
      // [GUARD] A cleared transcript (or a restarted Studio) is another
      // conversation: nothing of the last one is carried into it.
      const read = await ports.transcript.since(cursor, signal);
      if (read.epoch !== epoch) {
        const again = cursor > 0;
        forget(read.epoch);
        await restore(read.cursor);
        if (again) return true;
      }
      session = read.session;
      space = read.space ?? "live";
      // An unnamed voice is treated as the interviewer's: the coach would
      // sooner wait for it than talk over a question.
      speaking = read.speaking
        ? {
            interviewer: read.speaking.some((who) => who !== "candidate"),
            candidate: read.speaking.includes("candidate"),
          }
        : undefined;
      // The latest stop among the voices that are not the candidate's.
      const stops = (read.stopped ?? [])
        .filter((each) => each.speaker !== "candidate")
        .map((each) => Date.parse(each.at))
        .filter(Number.isFinite);
      interviewerStoppedMs =
        speaking && !speaking.interviewer && stops.length > 0
          ? Math.max(...stops)
          : undefined;
      // A screen that reads differently is a screen not yet looked at.
      if (read.screen && read.screen.text !== screen?.text)
        screen = { text: read.screen.text, seen: false };
      if (read.lines.length > 0) {
        lines = [...lines, ...read.lines].slice(-LINES_HELD);
        cursor = read.cursor;
        lastArrivalMs = now();
      }

      // The call in hand has ended: what it read is decided on.
      if (running?.settled) {
        const ended = running;
        running = undefined;
        if (ended.error !== undefined && !signal.aborted) {
          failures += 1;
          tell({
            what: "failed",
            reason: ended.reason,
            from: ended.from,
            until: ended.until,
            key: ended.key,
          });
          // A stretch that cannot be answered or shown (the model failed, or
          // Studio refused the note) is passed over, not retried for ever:
          // the conversation has moved on.
          const final =
            ended.error instanceof CoachCallError &&
            ended.error.failure?.retryable === false;
          if (failures < ATTEMPTS && !final) throw ended.error;
        }
        failures = 0;
        readTo = Math.max(readTo, ended.until);
        keep();
        return true;
      }

      if (running) {
        // The interviewer went on after the call began: make it again with
        // the whole turn, under the same note.
        const hand = running;
        const added = lines.filter((line) => line.seq > hand.until);
        if (
          running.about === "interviewer" &&
          running.recalls < RECALLS &&
          shouldRecall(added, turnText(lines, hand.from, hand.until))
        ) {
          const recalled = running;
          recalled.stop.abort();
          await recalled.done;
          running = undefined;
          tell({
            what: "recall",
            reason: recalled.reason,
            from: recalled.from,
            until: recalled.until,
            key: recalled.key,
          });
          recallsLeft = RECALLS - recalled.recalls - 1;
          return true;
        }
        return false;
      }

      // The plan says what kind of round this is, so it is known before the
      // first call as well as during it.
      if (ports.plan && (!plan || now() - plan.atMs > PLAN_HELD_MS))
        plan = {
          text: await ports.plan().catch(() => plan?.text),
          atMs: now(),
        };
      const fresh = lines.filter((line) => line.seq > readTo);
      // [DOMAIN] In live coding the task is on the screen, not in the talk:
      // a changed screen is looked at once things are quiet, whether or not
      // anything new was said. Elsewhere the screen is only context.
      const last = lines.at(-1);
      if (
        screen &&
        !screen.seen &&
        last &&
        modeOf(plan?.text) === "coding" &&
        now() - lastArrivalMs >= SCREEN_QUIET_MS &&
        now() - lastActMs >= SCREEN_EVERY_MS
      ) {
        screen.seen = true;
        const read = fresh.length > 0 ? fresh : [last];
        const from = (read[0] as CoachTranscriptLine).seq;
        return start(
          read,
          {
            from,
            key: `coach-${epoch.slice(0, 8)}-screen-${from}`,
            until: (read.at(-1) as CoachTranscriptLine).seq,
          },
          { reason: "screen-change", about: "candidate" },
          signal,
        );
      }
      if (fresh.length === 0) return false;
      const decision = decide({
        fresh,
        ...(speaking ? { speaking } : {}),
        silenceMs: now() - lastArrivalMs,
        // [GUARD] A stop is the end of the words last heard only when it is
        // near them: one from long before the text is some earlier phrase's.
        // One dated after now is another clock's, and is not believed.
        ...(interviewerStoppedMs !== undefined &&
        interviewerStoppedMs <= now() &&
        interviewerStoppedMs >= lastArrivalMs - STOP_BEFORE_TEXT_MS
          ? { interviewerQuietMs: now() - interviewerStoppedMs }
          : {}),
        sinceActMs: now() - lastActMs,
        ...(timing ? { timing } : {}),
      });
      if (decision.action === "wait") return false;

      const batch = fresh.filter((line) => line.seq <= decision.until);
      if (decision.about === "candidate") {
        // [DOMAIN] An answer is looked at twice at most and nudged once: a
        // person speaking cannot take in more than that.
        if (nudged || looks >= ANSWER_LOOKS) {
          readTo = decision.until;
          return false;
        }
        looks += 1;
      }
      // [DOMAIN] The interviewer adding a sentence before the candidate has
      // spoken is still asking the same thing: its note is revised in place,
      // not joined by a second one.
      const earlier = lastTurn;
      const sameTurn =
        decision.about === "interviewer" &&
        earlier !== undefined &&
        now() - earlier.atMs <= SAME_TURN_MS &&
        !turnsOf(lines.filter((line) => line.seq >= earlier.from)).some(
          (turn) => turn.side === "candidate",
        );
      const from =
        sameTurn && earlier
          ? earlier.from
          : (batch[0] as CoachTranscriptLine).seq;
      // [GUARD] The note is named by where its stretch begins, so a call made
      // again (the interviewer went on, or a first attempt failed) takes the
      // first one's place in the window instead of leaving a half-written
      // note beside the new one.
      const key =
        sameTurn && earlier
          ? earlier.key
          : `coach-${epoch.slice(0, 8)}-${from}`;
      if (decision.about === "interviewer") {
        lastTurn = { from, key, atMs: now() };
        if (!sameTurn) {
          looks = 0;
          nudged = false;
        }
      }
      return start(
        batch,
        { from, key, until: decision.until },
        { reason: decision.reason, about: decision.about },
        signal,
      );
    },
    // Settles when the call in hand has (at once when there is none). For a
    // replay that steps its own clock, and for tests.
    async idle(): Promise<void> {
      await running?.done;
    },
  };
}

export type Coach = ReturnType<typeof createCoach>;
