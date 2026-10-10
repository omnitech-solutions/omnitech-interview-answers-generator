// Replays a recorded conversation through the live coach, to see when it
// acts, why, and what it writes.
//
//   pnpm coach:replay <file> --speakers
//       who is in the file: each label, how much they said, a first sentence
//   pnpm coach:replay <file> --interviewer "Speaker 1" --me "Speaker 2" --timing
//       when the coach would act and why; no model is called, it takes a second
//   pnpm coach:replay <file> --interviewer "Speaker 1" --me "Speaker 2" \
//       --from 10:39:50 --to 10:47:00 --runtime claude
//       the same stretch with Claude Code writing the notes, at the speed it
//       was said
//
// Options
//   --interviewer L   --me L   --leave-out L     a label's part; repeat, or a,b
//   --unknown-is interviewer|me|leave-out        what unnamed labels are
//   --plan FILE       the plan for the call, given to the coach with every stretch
//   --trace           print everything: each prompt the model is given, its raw
//                     reply, and each revision of each note as it is posted
//   --bench NAME      a call fixture (fixtures/calls/NAME): its transcript, its
//                     plan, who is who and what is expected, in one word
//   --results DIR     where a benchmark's result is kept and the last looked
//                     for (default .dev-local/benchmarks/)
//   --expect FILE     a benchmark: the questions the stretch holds and the words
//                     that complete each. The run is scored against them, the
//                     result is kept in .dev-local/benchmarks/ and compared with
//                     the last run of the same benchmark on the same runtime
//   --no-activity     do not tell the coach who is speaking (by default a replay
//                     derives it from the recording's timings, as a stand-in
//                     for a voice-activity signal)
//   --no-names        do not tell the coach which interviewer spoke. By default a
//                     replay with more than one interviewer label gives each
//                     line its label as the speaker's name (the recorder told
//                     them apart). A call heard live is one stream with nobody
//                     named: this replays a panel the way it is heard live
//   --signals ideal|vad    what the replay knows of who is speaking. ideal (the
//                     default): exactly the recording's timings. vad: as a
//                     voice detector hears it, a start told 150 ms late, a
//                     stop 500 ms late, pauses shorter than that not heard,
//                     and each piece of text 300 ms after it was said
//   --no-voice-stop   do not tell the coach when a voice stopped: it counts the
//                     silence after a turn from when the words arrived
//   --endpoint FILE   a module that decides when a speaker's turn is over, in
//                     place of the replay's own reading of the signals. Its
//                     default export is given { kind } and returns
//                     { apply(events, nowMs), ready(role, nowMs), close?() }
//   --endpoint-kind K which of the module's mechanisms
//   --endpoint-owns   the endpoint alone says when the interviewer has
//                     finished: the coach's own waits after a turn are zero
//   --label L         kept with a benchmark's name, so each variant is
//                     compared with its own last run
//   --retain          keep one session of the model open for the whole replay
//                     (each turn then sends only what is new)
//   --grounding strict|plain    how closely a note is held to what the coach
//                     was given (coach/prompt.ts). strict (the default): the
//                     person's own notes are told apart from the employer's
//                     material and the grounding rules are in force. plain:
//                     the prompt as it was (live-coach-9)
//   --cite words|pointer    how a claim that cites a fact is checked before it
//                     is marked verified (coach/reply.ts). words (the
//                     default): the cited fact must also say the claim.
//                     pointer: the pointer and its figures alone, as it was
//   --hide-me         the coach does not hear the person being coached
//   --from T --to T   the stretch to replay (HH:MM:SS of the file's clock)
//   --timing          decisions only, no model
//   --latency S       with --timing: how long the absent model takes (default 4)
//   --runtime claude|codex|scripted    who writes the notes (default claude).
//                     scripted: no model. Each note cites the first fact of a
//                     role the coach was given, after --latency seconds of the
//                     file's clock (stepped by hand, as --timing is, so the
//                     run is the same every time and --speed is not used)
//   --speed N         N times faster than it was said (default 1). Above 1 a
//                     model's delay looks N times longer than it is.
//   --studio          also show the notes in the running Studio's notes pane,
//                     as replay notes: kept apart from your own, in memory
//
// The person's material, and what the notes SAY
//   --transcript FILE the transcript, named instead of given first
//   --matrix FILE --brief FILE    the person's experience matrix and the
//                     employer brief (or an application row holding one under
//                     `employer_brief`). Given, the coach draws its facts from
//                     the context pack's coach projection exactly as the live
//                     coach does (coach/context.ts), as a REMOTE reader: a
//                     device-only source is withheld
//   --application FILE    the application: stages, employerSaid, research. A
//                     transcript may name its words by "textFile", a path from
//                     that file's folder
//   --preferences FILE    the person's preferences, as lines of text
//   --kept FILE       a pack a model prepared earlier (a `Prepared`), read
//                     with today's material wherever its sources still stand
//   --stage N         the stage of the application the call is
//   --within S        a note's first line is in time when it is on screen
//                     this many seconds after the question's last word
//                     (default 10)
//   --private         treat the run as one on a person's own files (below)
// Every path may be absolute, under ~, from where the command runs, or from
// the repository's root. With material (or an expected file that names
// `evidence`), each question's note is scored: which employers its verified
// claims belong to, whether the pack offered an accepted employer's fact at
// all, and the figures and employer names it states that nobody gave it
// (coach-notes-score.ts).
//
// [SAFETY] A person's own files. When one of these flags is given and the
// transcript, the plan, the expected file or any material file is OUTSIDE the
// repository, what is printed (without --trace) and what is kept hold ids,
// pointers, counts, clock times and scores only: never the words of a note, a
// fact, a question or a line, and never a speaker's name. The result is then
// kept only under .dev-local/ or outside the repository.
//
// Nothing is kept: the transcript and the notes of a replay live in this
// process, unless --studio is given. With no part named for any label and a
// terminal to ask in, it asks.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type AiEngine,
  agentRuntime,
  createAgentModelPort,
  createAiEngine,
} from "@omnitech/ai-engine";
import { resolveAgentProfiles } from "@omnitech/platform-runtime/ai-config";
import {
  type Cast,
  type CoachEvent,
  type CoachFact,
  type CoachPorts,
  castBlocks,
  createCoach,
  createCoachContextFrom,
  type ReplayMaterial,
  ReplayMaterialError,
  readReplayMaterial,
  readTranscript,
  type SpeakerRole,
  speakersOf,
  turnsOf,
} from "@omnitech/product-interview/session-worker";
import { coachApi } from "./coach-loop";
import {
  expectationOf,
  type NoteScore,
  type NoteTotals,
  scoreNote,
  scriptedReply,
  totalsLine,
  totalsOf,
  verifiedSources,
} from "./coach-notes-score";
import { workerEngineLog } from "./engine-trace";
import { agentEnvironment } from "./main";

type CoachNoteInput = Parameters<CoachPorts["notes"]["post"]>[0];
type CoachTranscriptLine = Awaited<
  ReturnType<CoachPorts["transcript"]["since"]>
>["lines"][number];

const args = process.argv.slice(2);
const VALUED = new Set([
  "--interviewer",
  "--me",
  "--leave-out",
  "--unknown-is",
  "--from",
  "--to",
  "--runtime",
  "--speed",
  "--latency",
  "--plan",
  "--expect",
  "--bench",
  "--results",
  "--signals",
  "--endpoint",
  "--endpoint-kind",
  "--label",
  "--transcript",
  "--matrix",
  "--brief",
  "--application",
  "--preferences",
  "--kept",
  "--stage",
  "--within",
  "--grounding",
  "--cite",
]);
const all = (name: string): string[] =>
  args.flatMap((arg, at) =>
    arg === name ? (args[at + 1] ?? "").split(",").map((v) => v.trim()) : [],
  );
const has = (name: string) => args.includes(name);
// A fixture names its own transcript, plan and expectations.
const bench = all("--bench").at(-1);
const fixture = (part: string) =>
  fileURLToPath(new URL(`../fixtures/calls/${bench}/${part}`, import.meta.url));
// [DOMAIN] Where a named file is. `pnpm --filter … exec` runs in this
// package's folder, so a path that is neither absolute, nor under the home
// folder, nor there from where the command runs is read from the
// repository's root (as scripts/pack-bench.ts reads its own).
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const locate = (given: string): string => {
  const expanded = given.replace(/^~(?=\/)/, homedir());
  return isAbsolute(expanded) || existsSync(expanded)
    ? expanded
    : resolve(ROOT, expanded);
};
const one = (name: string) => {
  const given = all(name).at(-1);
  if (given !== undefined)
    return name === "--expect" || name === "--plan" ? locate(given) : given;
  return bench === undefined
    ? undefined
    : name === "--expect"
      ? fixture("expected.json")
      : name === "--plan" && existsSync(fixture("plan.md"))
        ? fixture("plan.md")
        : undefined;
};
// A file named by a flag of its own, whole (a path may hold a comma).
const pathAt = (name: string) => {
  const at = args.lastIndexOf(name);
  const given = at === -1 ? undefined : args[at + 1];
  return given === undefined ? undefined : locate(given);
};
const given =
  pathAt("--transcript") ??
  args.find(
    (arg, at) => !arg.startsWith("--") && !VALUED.has(args[at - 1] ?? ""),
  );
const file =
  given === undefined
    ? bench === undefined
      ? undefined
      : fixture("transcript.txt")
    : locate(given);
if (!file) {
  console.error("Give the transcript file. See the top of coach-replay.ts.");
  process.exit(1);
}

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const clockMs = (text: string | undefined) => {
  const found = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(text ?? "");
  return found
    ? (Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3])) *
        1000
    : undefined;
};
const short = (text: string, length = 96) =>
  text.length <= length ? text : `${text.slice(0, length - 1)}…`;

// ---- The person's material, and whose files these are -------------------------

const materialFiles = {
  matrix: pathAt("--matrix"),
  brief: pathAt("--brief"),
  application: pathAt("--application"),
  preferences: pathAt("--preferences"),
  kept: pathAt("--kept"),
};
const stageGiven = all("--stage").at(-1);
// [GUARD] A pack is prepared from the person's record and the employer's
// brief together: a part of the material without both is refused, never
// replayed as though nothing had been given.
if (
  (Object.values(materialFiles).some((each) => each !== undefined) ||
    stageGiven !== undefined) &&
  !(materialFiles.matrix && materialFiles.brief)
) {
  console.error("The person's material needs --matrix and --brief together.");
  process.exit(2);
}
if (stageGiven !== undefined && !/^[1-9]\d*$/.test(stageGiven)) {
  console.error("--stage is the stage's place: 1, 2, 3…");
  process.exit(2);
}
const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};
const inside = (folder: string, path: string) => {
  const from = relative(real(folder), real(path));
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
};
// [SAFETY] A person's own files: a run that reads any file from outside the
// repository says and keeps ids, pointers, counts, clock times and scores,
// and never what was said or written. It holds for every run given one of
// the flags above; a replay with none of them prints as it always has.
const outside = [
  file,
  one("--expect"),
  one("--plan"),
  ...Object.values(materialFiles),
].some((each) => each !== undefined && !inside(ROOT, each));
const guarded =
  has("--private") ||
  (outside &&
    [
      "--transcript",
      "--matrix",
      "--brief",
      "--application",
      "--preferences",
      "--kept",
      "--stage",
      "--within",
    ].some(has));

// Where results are kept: named from the repository's root like every other
// path, never from this package's folder (where the command runs).
const resultsGiven = pathAt("--results");
// [SAFETY] A person's own call is scored into .dev-local/ (which is never
// committed) or somewhere outside the repository: nowhere it could be added
// to a commit by accident. Refused before anything is replayed.
if (
  guarded &&
  resultsGiven &&
  inside(ROOT, resultsGiven) &&
  !inside(resolve(ROOT, ".dev-local"), resultsGiven)
) {
  console.error(
    "A person's own call is kept under .dev-local/ or outside the repository: choose another --results.",
  );
  process.exit(2);
}

let source = "";
try {
  source = readFileSync(file, "utf8");
} catch {
  console.error(`That file could not be read: ${file}`);
  process.exit(1);
}
const blocks = readTranscript(source);
if (blocks.length === 0) {
  console.error("Nothing said was found in that file.");
  process.exit(1);
}
const speakers = speakersOf(blocks);
const listSpeakers = () => {
  for (const each of speakers)
    console.log(
      `  ${(each.label || "(no label)").padEnd(14)} ${String(each.words).padStart(6)} words in ${String(each.blocks).padStart(4)} pieces${
        // The labels are what is asked for; a first sentence is what was said.
        guarded ? "" : `   "${short(each.sample, 70)}"`
      }`,
    );
};
if (has("--speakers")) {
  console.log(
    `${file}: ${clock(blocks[0]?.startMs ?? 0)} to ${clock(blocks.at(-1)?.endMs ?? 0)}`,
  );
  listSpeakers();
  process.exit(0);
}

// ---- Who is who -------------------------------------------------------------

const cast: Record<string, SpeakerRole> = {};
for (const label of all("--interviewer")) cast[label] = "interviewer";
for (const label of all("--me")) cast[label] = "me";
for (const label of all("--leave-out")) cast[label] = "leave-out";
// A fixture says who is who.
if (bench !== undefined && Object.keys(cast).length === 0) {
  const named = JSON.parse(readFileSync(fixture("expected.json"), "utf8")) as {
    interviewer?: string[];
    me?: string[];
  };
  for (const label of named.interviewer ?? []) cast[label] = "interviewer";
  for (const label of named.me ?? []) cast[label] = "me";
}
if (Object.keys(cast).length === 0 && process.stdin.isTTY) {
  console.log("Who is in this conversation?");
  listSpeakers();
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  for (const each of speakers) {
    const said = (
      await ask.question(
        `  ${each.label || "(no label)"}: [i]nterviewer, [m]e, [l]eave out, [u]nknown? `,
      )
    )
      .trim()
      .toLowerCase();
    cast[each.label] = said.startsWith("i")
      ? "interviewer"
      : said.startsWith("m")
        ? "me"
        : said.startsWith("l")
          ? "leave-out"
          : "unknown";
  }
  ask.close();
}
const unnamed = one("--unknown-is");
if (unnamed)
  for (const each of speakers)
    if (!(each.label in cast))
      cast[each.label] = (unnamed === "me" ? "me" : unnamed) as SpeakerRole;

const heard = castBlocks(blocks, cast as Cast, {
  hideMe: has("--hide-me"),
  ...(has("--no-names") ? { names: false } : {}),
  ...(clockMs(one("--from")) === undefined
    ? {}
    : { fromMs: clockMs(one("--from")) as number }),
  ...(clockMs(one("--to")) === undefined
    ? {}
    : { toMs: clockMs(one("--to")) as number }),
});
// The interviewers the coach will be told apart, in the order first heard.
const voices = [
  ...new Set(heard.flatMap((block) => (block.name ? [block.name] : []))),
];
if (heard.length === 0) {
  console.error("Nothing is left to replay with those speakers and times.");
  process.exit(1);
}

// ---- The replay -------------------------------------------------------------

const timingOnly = has("--timing");
// [DOMAIN] Notes written by a script, not a model: the whole path from the
// facts to a scored note runs with nothing called, the same every time.
const scripted = !timingOnly && one("--runtime") === "scripted";
// Neither waits on a model, so both step the file's clock by hand.
const stepped = timingOnly || scripted;
const speed = stepped ? 1 : Math.max(1, Number(one("--speed") ?? "1") || 1);
const first = (heard[0] as (typeof heard)[number]).endMs - 1_000;
const last = (heard.at(-1) as (typeof heard)[number]).endMs;

// The file's clock. Timing only: stepped by hand, as fast as the machine
// goes. With a model: the wall clock, `speed` times faster.
let now = first;
const wallStart = Date.now();
const fileNow = () =>
  stepped ? now : first + (Date.now() - wallStart) * speed;

let seq = 0;
const lines: CoachTranscriptLine[] = [];
const bySeq = new Map<number, (typeof heard)[number]>();
let next = 0;
const feed = () => {
  while (
    next < heard.length &&
    (heard[next] as (typeof heard)[number]).endMs + ASR_MS <= fileNow()
  ) {
    const block = heard[next] as (typeof heard)[number];
    next += 1;
    seq += 1;
    bySeq.set(seq, block);
    lines.push({
      seq,
      speaker: block.speaker,
      ...(block.name ? { name: block.name } : {}),
      text: block.text,
      at: new Date(block.endMs).toISOString(),
    });
  }
};

// [DOMAIN] Who is speaking, taken from the recording's own timings: a piece
// that has begun and not yet ended is someone still talking. This stands in
// for a voice-activity signal; it is derived from the transcript, not heard.
const activity = !has("--no-activity");
// [DOMAIN] The signals as a detector gives them, so that every way of ending
// a turn is judged on what it would really be told: a voice is known to have
// started and stopped a little after it did, a short pause is not heard at
// all, and text comes after the words.
const detected = one("--signals") === "vad";
const ONSET_MS = detected ? 150 : 0;
const HANGOVER_MS = detected ? 500 : 0;
const ASR_MS = detected ? 300 : 0;
type Signal =
  | {
      type: "activity";
      role: (typeof heard)[number]["speaker"];
      active: boolean;
      // When it is known, and when it happened.
      atMs: number;
      speechAtMs: number;
    }
  | {
      type: "transcript";
      role: (typeof heard)[number]["speaker"];
      id: string;
      text: string;
      final: true;
      // The last piece of a stretch of speech.
      utteranceFinal: boolean;
      atMs: number;
      startMs: number;
      endMs: number;
    };
// Each speaker's stretches of voice: pieces with less than the hangover
// between them are one stretch.
const stretches = (() => {
  const found: { role: Signal["role"]; startMs: number; endMs: number }[] = [];
  const open = new Map<Signal["role"], (typeof found)[number]>();
  for (const block of [...heard].sort((a, b) => a.startMs - b.startMs)) {
    const last = open.get(block.speaker);
    if (last && block.startMs - last.endMs <= HANGOVER_MS)
      last.endMs = Math.max(last.endMs, block.endMs);
    else {
      const next = {
        role: block.speaker,
        startMs: block.startMs,
        endMs: block.endMs,
      };
      found.push(next);
      open.set(block.speaker, next);
    }
  }
  return found;
})();
const signals: Signal[] = [
  ...stretches.flatMap((stretch): Signal[] => [
    {
      type: "activity",
      role: stretch.role,
      active: true,
      atMs: stretch.startMs + ONSET_MS,
      speechAtMs: stretch.startMs,
    },
    {
      type: "activity",
      role: stretch.role,
      active: false,
      atMs: stretch.endMs + HANGOVER_MS,
      speechAtMs: stretch.endMs,
    },
  ]),
  ...heard.map(
    (block, at): Signal => ({
      type: "transcript",
      role: block.speaker,
      id: `t${at + 1}`,
      text: block.text,
      final: true,
      utteranceFinal: stretches.some(
        (stretch) =>
          stretch.role === block.speaker && stretch.endMs === block.endMs,
      ),
      atMs: block.endMs + ASR_MS,
      startMs: block.startMs,
      endMs: block.endMs,
    }),
  ),
].sort((a, b) => a.atMs - b.atMs);
const speakingAt = (atMs: number) =>
  detected
    ? // What a detector has said by now: started and not yet stopped.
      [
        ...new Set(
          stretches
            .filter(
              (stretch) =>
                stretch.startMs + ONSET_MS <= atMs &&
                atMs < stretch.endMs + HANGOVER_MS,
            )
            .map((stretch) => stretch.role),
        ),
      ]
    : [
        ...new Set(
          heard
            .filter((block) => block.startMs < atMs && atMs < block.endMs)
            .map((block) => block.speaker),
        ),
      ];
// When each speaker's voice last stopped, as far as is known by now.
const stoppedAt = (atMs: number) =>
  (["interviewer", "candidate", "unknown"] as const).flatMap((role) => {
    const last = stretches
      .filter(
        (stretch) =>
          stretch.role === role && stretch.endMs + HANGOVER_MS <= atMs,
      )
      .at(-1);
    return last
      ? [{ speaker: role, at: new Date(last.endMs).toISOString() }]
      : [];
  });

// [DOMAIN] Another mechanism for ending a turn (a framework's endpointing),
// given the same signals. It is asked one thing, whether a speaker's turn is
// over, and the coach is told "still speaking" while it says no.
type Endpoint = {
  identity?: unknown;
  apply(events: readonly Signal[], nowMs: number): void | Promise<void>;
  ready(role: Signal["role"], nowMs: number): boolean;
  close?(): void | Promise<void>;
};
let endpoint: Endpoint | undefined;
if (one("--endpoint")) {
  const made = (await import(
    pathToFileURL(resolve(one("--endpoint") as string)).href
  )) as {
    default: (options: { kind?: string }) => Endpoint | Promise<Endpoint>;
  };
  const kind = one("--endpoint-kind");
  endpoint = await made.default(kind ? { kind } : {});
}
let told = 0;
let endpointSays: Signal["role"][] = [];
const askEndpoint = async () => {
  if (!endpoint) return;
  const at = fileNow();
  const batch: Signal[] = [];
  while (told < signals.length && (signals[told] as Signal).atMs <= at)
    batch.push(signals[told++] as Signal);
  await endpoint.apply(batch, at);
  endpointSays = (["interviewer", "candidate", "unknown"] as const).filter(
    (role) => !(endpoint as Endpoint).ready(role, at),
  );
};

// A stand-in that says nothing, after as long as a model takes: the decisions
// are what is being looked at, and a call that is still running when the
// interviewer goes on is part of them.
const latencyMs = Math.max(0, Number(one("--latency") ?? "4") || 0) * 1_000;
const pending: { atMs: number; go: () => void }[] = [];
const silent = {
  async *stream(_input: unknown, execution: { signal: AbortSignal }) {
    await new Promise<void>((go) => {
      pending.push({ atMs: now + latencyMs, go });
      execution.signal.addEventListener("abort", () => go(), { once: true });
    });
    yield execution.signal.aborted
      ? { type: "cancelled" }
      : { type: "done", value: null };
  },
} as unknown as Pick<AiEngine, "stream">;

// ---- The facts the coach is given -------------------------------------------

let material: ReplayMaterial | undefined;
if (materialFiles.matrix && materialFiles.brief)
  try {
    material = readReplayMaterial({
      ...materialFiles,
      matrix: materialFiles.matrix,
      brief: materialFiles.brief,
      ...(stageGiven === undefined ? {} : { stage: Number(stageGiven) }),
    });
  } catch (error) {
    // [SAFETY] Which file was wrong, never what it holds.
    console.error(
      error instanceof ReplayMaterialError
        ? error.message
        : "The person's material could not be read.",
    );
    process.exit(1);
  }
// The session a replay with material is heard in: what makes the coach ask
// for its facts at all (coach.ts), under the scope a replay always had.
const SESSION = {
  tenantId: "local",
  actorId: "coach-replay",
  sessionId: "coach-replay",
};
// What the coach was given for the turn it is on: why it acted, how far it
// had heard, and the facts its context selected. One call runs at a time, so
// the turn in hand is the last one acted on.
type Turn = { reason: string; until: number; facts: CoachFact[] };
let turn: Turn = { reason: "", until: 0, facts: [] };
// [STRATEGY] The live coach's own context, given the material from files in
// place of the database: the pack is prepared, read as a remote reader and
// resolved under the coach projection by the one path every coach takes
// (coach/context.ts). All the replay adds is a note of what came back.
const context = (() => {
  if (!material) return undefined;
  const { context: session, kept } = material;
  const own = createCoachContextFrom(
    createAiEngine({ profiles: [], providers: {}, log: { level: "silent" } }),
    async () => ({ context: session, kept }),
    // The files do not change while they are replayed: prepared once.
    () => 0,
  );
  return {
    facts: async (...asked: Parameters<typeof own.facts>) => {
      const mine = turn;
      const facts = await own.facts(...asked);
      mine.facts = facts;
      return facts;
    },
  };
})();

// [DOMAIN] The scripted note-writer: after as long as a model takes on the
// file's clock, one note built from the facts the coach was given for the
// turn (coach-notes-score.ts). A call the interviewer talks over is cancelled
// and made again, as a model's is.
const script = {
  async *stream(_input: unknown, execution: { signal: AbortSignal }) {
    const mine = turn;
    await new Promise<void>((go) => {
      pending.push({ atMs: now + latencyMs, go });
      execution.signal.addEventListener("abort", () => go(), { once: true });
    });
    if (execution.signal.aborted) {
      yield { type: "cancelled" };
      return;
    }
    yield { type: "text", text: scriptedReply(mine) };
    yield { type: "done", value: null };
  },
} as unknown as Pick<AiEngine, "stream">;

function scriptEngine(): Pick<AiEngine, "stream"> {
  console.log(
    "Notes by a script (no model): each cites the first fact of a role the coach was given.",
  );
  return script;
}

let runtime: ReturnType<typeof agentRuntime> | undefined;
function modelEngine(): Pick<AiEngine, "stream"> {
  const chosen = one("--runtime") === "codex" ? "codex" : "claude-code";
  const agent = resolveAgentProfiles(process.env).get(
    chosen === "codex" ? "assistant-codex" : "assistant-claude-code",
  );
  if (!agent) throw new Error("That runtime has no profile on this machine.");
  runtime = agentRuntime({
    runtime: chosen,
    environment: agentEnvironment(process.env, chosen),
  });
  console.log(`Notes by ${chosen} (${agent.model}), ${speed}x.`);
  return createAiEngine({
    // The replay is a host like the worker: its engine says the same lines.
    log: workerEngineLog(process.env),
    profiles: [
      {
        id: "coach",
        label: "Coach replay",
        provider: "agent",
        kind: "agent",
        model: agent.model,
      },
    ],
    providers: {
      agent: createAgentModelPort({
        runtime,
        profiles: { coach: { ...agent, id: `replay-${agent.id}` } },
        toolless: true,
      }),
    },
  });
}

const studio = has("--studio")
  ? coachApi(
      process.env["INTERVIEW_API_URL"] ?? "http://127.0.0.1:3000",
      process.env["INTERVIEW_API_TOKEN"] ??
        readFileSync(
          new URL("../../../.dev-local/api-token", import.meta.url),
          "utf8",
        ).trim(),
    )
  : undefined;

// [DOMAIN] The two switches of what a note may claim, as the live coach has
// them (coach-loop.ts): on unless turned off, so a replay with neither flag
// is the coach as it runs.
const grounding = one("--grounding") === "plain" ? "plain" : "strict";
const cite = one("--cite") === "pointer" ? "pointer" : "words";

// What happened, for the summary.
type Acted = {
  atMs: number;
  endedMs: number;
  reason: string;
  firstMs?: number;
  lastMs?: number;
  note?: CoachNoteInput;
  silent?: boolean;
};
const acted = new Map<string, Acted>();
// Every act, in order (a turn answered again is another act), and the notes
// as they finally read, by the key the window knows them by.
let actions = 0;
const notes = new Map<
  string,
  // With the turn the note was last written for: its facts, how far was heard.
  { atMs: number; note: CoachNoteInput; turn: Turn }
>();
const firstLines: number[] = [];
let silences = 0;
let lastAct: { atMs: number; noted: boolean } | undefined;
// Every act with what came of it, for a benchmark's score.
type ActRecord = {
  atMs: number;
  reason: string;
  key: string;
  // The words of the turn acted on.
  turn: string;
  // When the last line of the stretch was said, on the file's clock.
  endedMs: number;
  // Real seconds from acting to the first line of its note, and to the last.
  firstLineS?: number;
  finalS?: number;
  recalled?: boolean;
  silent?: boolean;
  failed?: boolean;
  // What the coach was given for it.
  given: Turn;
};
const records: ActRecord[] = [];
const trace = has("--trace");
const counts: Record<string, number> = {};
const say = (atMs: number, text: string) =>
  console.log(`${clock(atMs)}  ${text}`);
const wait = (seconds: number) => `+${(seconds / 1000).toFixed(1)}s`;

function onEvent(event: CoachEvent) {
  const ended = bySeq.get(event.until)?.endMs ?? event.atMs;
  if (event.what === "act") {
    actions += 1;
    lastAct = { atMs: event.atMs, noted: false };
    counts[event.reason ?? "?"] = (counts[event.reason ?? "?"] ?? 0) + 1;
    const stretch = lines.filter(
      (line) => line.seq >= event.from && line.seq <= event.until,
    );
    const spoken = turnsOf(stretch).findLast((each) =>
      event.reason === "answer-check"
        ? each.side === "candidate"
        : each.side === "interviewer",
    );
    acted.set(event.key, {
      atMs: event.atMs,
      endedMs: ended,
      reason: event.reason ?? "",
    });
    turn = { reason: event.reason ?? "", until: event.until, facts: [] };
    records.push({
      atMs: event.atMs,
      reason: event.reason ?? "",
      key: event.key,
      turn: spoken?.text ?? "",
      endedMs: ended,
      given: turn,
    });
    say(
      event.atMs,
      `ACT    ${(event.reason ?? "").padEnd(17)} ${wait(event.atMs - ended)} after ${
        // [SAFETY] A person's own call: where the turn is, never its words.
        guarded
          ? `lines ${event.from} to ${event.until} (${(spoken?.text ?? "").split(/\s+/).filter(Boolean).length} words)`
          : `"${short(spoken?.text ?? "", 110)}"`
      }`,
    );
  } else if (event.what === "recall") {
    counts["recall"] = (counts["recall"] ?? 0) + 1;
    const recalled = records.at(-1);
    if (recalled) recalled.recalled = true;
    say(
      event.atMs,
      "AGAIN  the interviewer went on: the call is made again with the whole turn",
    );
  } else if (event.what === "silent") {
    const held = acted.get(event.key);
    if (held) held.silent = true;
    silences += 1;
    const quiet = records.at(-1);
    if (quiet) quiet.silent = true;
    if (!timingOnly) say(event.atMs, "       (nothing worth a note)");
  } else if (event.what === "failed") {
    say(event.atMs, "FAILED the call did not finish");
    const broke = records.at(-1);
    if (broke) broke.failed = true;
  } else if (event.what === "note") {
    const written = records.at(-1);
    if (written && event.final && lastAct)
      written.finalS = (event.atMs - lastAct.atMs) / speed / 1000;
    // The first line of the note this act led to, in real seconds.
    if (lastAct && !lastAct.noted) {
      lastAct.noted = true;
      const delay = (event.atMs - lastAct.atMs) / speed;
      firstLines.push(delay);
      const noted = records.at(-1);
      if (noted) noted.firstLineS = delay / 1000;
      say(
        event.atMs,
        `NOTE   first line ${wait(delay)} after acting (real time)`,
      );
    }
  }
}

// The plan for the call, from a file, as the person would have written it.
let planText: string | undefined;
if (one("--plan"))
  try {
    planText = readFileSync(one("--plan") as string, "utf8");
  } catch {
    console.error(`That file could not be read: ${one("--plan")}`);
    process.exit(1);
  }
// [DOMAIN] The full trace: what the model was given and what it wrote, call by
// call. This is the conversation's content, printed only when asked for.
let calls = 0;
function traced(engine: Pick<AiEngine, "stream">): Pick<AiEngine, "stream"> {
  if (!trace) return engine;
  return {
    async *stream(input, execution, options) {
      calls += 1;
      const call = calls;
      const began = Date.now();
      const prompt = input.messages
        .filter((message) => message.role === "user")
        .flatMap((message) =>
          message.parts.map((part) => (part.type === "text" ? part.text : "")),
        )
        .join("\n");
      console.log(`\n──── call ${call}: prompt ─────────────────────────────`);
      console.log(prompt);
      let reply = "";
      let first: number | undefined;
      // [GUARD] The coach stops reading at the terminal part, which ends this
      // generator where it stands: the reply is printed on the way out, or a
      // call that finished would never show what the model wrote.
      try {
        for await (const part of engine.stream(input, execution, options)) {
          if (part.type === "text") {
            first ??= Date.now() - began;
            reply += part.text;
          }
          if (part.type === "failed")
            console.log(
              `──── call ${call}: failed (${part.failure.code}) ────`,
            );
          yield part;
        }
      } finally {
        console.log(
          `──── call ${call}: reply (first text ${first === undefined ? "none" : `${(first / 1000).toFixed(1)}s`}, whole ${((Date.now() - began) / 1000).toFixed(1)}s) ────`,
        );
        console.log(reply.trim() || "(nothing)");
        console.log(
          "────────────────────────────────────────────────────────\n",
        );
      }
    },
  };
}

const coach = createCoach(
  {
    engine: timingOnly
      ? silent
      : traced(scripted ? scriptEngine() : modelEngine()),
    profileId: "coach",
    transcript: {
      since: async (after) => ({
        epoch: "replay",
        cursor: seq,
        lines: lines.filter((line) => line.seq > after),
        ...(context ? { session: SESSION } : {}),
        ...(endpoint
          ? { speaking: endpointSays }
          : activity
            ? {
                speaking: speakingAt(fileNow()),
                ...(has("--no-voice-stop")
                  ? {}
                  : { stopped: stoppedAt(fileNow()) }),
              }
            : {}),
      }),
    },
    notes: {
      post: async (note, signal) => {
        if (trace)
          console.log(
            `     note ${note.key} revision ${note.revision}: ${(
              note.sections ?? []
            )
              .flatMap((section) =>
                section.lines.map(
                  (line) =>
                    `[${section.kind}] ${line.segments.map((segment) => segment.text).join("")}`,
                ),
              )
              .join(" | ")}`,
          );
        notes.set(note.key ?? "", {
          atMs: notes.get(note.key ?? "")?.atMs ?? fileNow(),
          note,
          turn,
        });
        await studio?.notes.post(note, signal, "replay");
      },
    },
    ...(planText ? { plan: async () => planText } : {}),
    ...(context ? { context } : {}),
    scope: { tenantId: "local", actorId: "coach-replay" },
    nowMs: fileNow,
    onEvent,
  },
  {
    retain: has("--retain"),
    grounding,
    cite,
    // The endpoint alone ends the interviewer's turn: nothing is waited after.
    ...(endpoint && has("--endpoint-owns")
      ? { timing: { finishedMs: 0, pauseMs: 0, trailingMs: 0 } }
      : {}),
  },
);

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
console.log(
  `Replaying ${clock(first + 1_000)} to ${clock(last)}: ${heard.length} pieces. ${
    // [SAFETY] A person's own call: how many of each part, never who.
    guarded
      ? (["interviewer", "me", "leave-out", "unknown"] as const)
          .map(
            (role) =>
              [
                role,
                Object.values(cast).filter((each) => each === role).length,
              ] as const,
          )
          .filter(([, count]) => count > 0)
          .map(([role, count]) => `${count} ${role}`)
          .join(", ")
      : Object.entries(cast)
          .map(([label, role]) => `${label || "(no label)"} = ${role}`)
          .join(", ")
  }.${
    // A panel: whether the coach is told which interviewer says each line.
    voices.length > 0
      ? ` The coach is told who speaks: ${guarded ? `${voices.length} interviewers` : voices.join(", ")}.`
      : has("--no-names")
        ? " The coach is not told which interviewer speaks."
        : ""
  }`,
);
// The coach hears a little past the last word, as it would in the room.
const end = last + 10_000;
while (fileNow() < end && !stop.signal.aborted) {
  feed();
  await askEndpoint();
  try {
    await coach.tick(stop.signal);
  } catch {
    // A failed call was reported as it happened; the replay goes on.
  }
  if (stepped) {
    now += 200;
    for (const call of pending.splice(0))
      if (call.atMs <= now) call.go();
      else pending.push(call);
    // Let what those calls woke run before the next look.
    await new Promise((resolve) => setImmediate(resolve));
  } else
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(20, 200 / speed)),
    );
}
if (!stepped)
  await Promise.race([
    coach.idle(),
    new Promise((resolve) => setTimeout(resolve, 60_000)),
  ]);
await runtime?.close?.();

// ---- What it came to --------------------------------------------------------

if (!timingOnly)
  for (const { atMs, note } of notes.values()) {
    // [SAFETY] A person's own call: what kind of note, how long, and how
    // much of it was verified against the record. Never what it says.
    if (guarded) {
      const segments = (note.sections ?? []).flatMap((section) =>
        section.lines.flatMap((line) => line.segments),
      );
      const claims = segments.filter((segment) => segment.role === "evidence");
      console.log(
        `${clock(atMs)}  ${note.kind}: ${(note.sections ?? []).reduce((sum, section) => sum + section.lines.length, 0)} lines, ${claims.filter((claim) => claim.grounding === "verified").length} claims verified, ${claims.filter((claim) => claim.grounding !== "verified").length} inferred${verifiedSources(note).length > 0 ? `  ${verifiedSources(note).join(" ")}` : ""}`,
      );
      continue;
    }
    console.log(
      `\n${clock(atMs)}  ${note.kind}: ${note.ask ?? note.title}${note.from ? `  (from ${note.from})` : ""}`,
    );
    for (const section of note.sections ?? [])
      for (const line of section.lines)
        console.log(
          `   ${section.kind.padEnd(8)} ${line.segments
            .map((segment) =>
              segment.role === "evidence"
                ? `**${segment.text}**${segment.grounding === "verified" ? "✓" : ""}`
                : segment.text,
            )
            .join("")}`,
        );
    if (note.diagram) console.log(note.diagram.replace(/^/gm, "   | "));
  }
const median = (values: number[]) =>
  values.length === 0
    ? undefined
    : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const answers = [...acted.values()].filter(
  (held) => held.reason !== "answer-check",
);
const toAct = median(answers.map((held) => held.atMs - held.endedMs));
const minutes = (last - first) / 60_000;
console.log(
  `\n${actions} actions in ${minutes.toFixed(1)} minutes (one every ${(
    (minutes * 60) / Math.max(1, actions)
  ).toFixed(0)} s): ${Object.entries(counts)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ")}.`,
);
if (toAct !== undefined)
  console.log(
    `From the end of the interviewer's turn to acting: median ${(toAct / 1000).toFixed(1)} s.`,
  );
if (!timingOnly) {
  const firstLine = median(firstLines);
  console.log(
    `${notes.size} notes, ${silences} silent.${
      firstLine === undefined
        ? ""
        : ` First line of a note: median ${(firstLine / 1000).toFixed(1)} s after acting.`
    }`,
  );
}
// ---- A benchmark's score ------------------------------------------------------

if (one("--expect")) {
  type Expected = {
    questions: {
      id: string;
      scenario?: string;
      // A question too quick to coach: nothing is asked of it.
      optional?: boolean;
      completeWhenSaid: string;
      about?: string[];
      // In a panel: the interviewer who asks it.
      from?: string;
      // The employers whose evidence a right note may draw on. An empty list
      // (or `nothing`): the material has nothing for it.
      evidence?: string[];
      nothing?: boolean;
    }[];
    // Things said that are no question for the candidate.
    quiet?: { id: string; said: string }[];
  };
  const whole = JSON.parse(
    readFileSync(one("--expect") as string, "utf8"),
  ) as Expected;
  const said = (text: string, phrase: string) =>
    text.toLowerCase().includes(phrase.toLowerCase());
  // [GUARD] A stretch of a call (--from, --to) is scored on the questions it
  // HOLDS: one whose completing words were never said in what was replayed
  // was not there to be answered, and counting it (as unanswered, or as a
  // question the material has nothing for and so "right") made a stretch's
  // totals mean nothing. A whole call is scored on every question, so one
  // that should have been heard and was not still shows.
  const stretched =
    clockMs(one("--from")) !== undefined || clockMs(one("--to")) !== undefined;
  const everySaid = heard
    .filter((block) => block.speaker !== "candidate")
    .map((block) => block.text)
    .join(" ");
  const expected: Expected = stretched
    ? {
        ...whole,
        questions: whole.questions.filter((question) =>
          said(everySaid, question.completeWhenSaid),
        ),
      }
    : whole;
  if (stretched)
    console.log(
      `\n${expected.questions.length} of ${whole.questions.length} expected questions are said in this stretch; the others are not scored.`,
    );
  const interviewerActs = records.filter(
    (record) =>
      record.reason !== "answer-check" && record.reason !== "screen-change",
  );
  // [DOMAIN] What the notes SAY is scored when there is something to score
  // them against: the person's material, or an expected file that says whose
  // evidence each question wants. A benchmark with neither is scored on when
  // the coach acts, as it always was.
  const scoring =
    material !== undefined ||
    has("--within") ||
    expected.questions.some((question) => expectationOf(question) !== null);
  const withinS = Math.max(0, Number(one("--within") ?? "10") || 0);
  const employers = material?.employers ?? [];
  const scores: (NoteScore | null)[] = [];
  const inventedItems: string[][] = [];
  const questions = expected.questions.map((question, at) => {
    // The acts on this question: those whose turn is about it and that came
    // before the next question was whole.
    const answered = interviewerActs.find((record) =>
      said(record.turn, question.completeWhenSaid),
    );
    const nextWhole = expected.questions[at + 1]
      ? interviewerActs.find((record) =>
          said(
            record.turn,
            (expected.questions[at + 1] as Expected["questions"][number])
              .completeWhenSaid,
          ),
        )
      : undefined;
    const before = interviewerActs.filter(
      (record) =>
        (!answered || record.atMs < answered.atMs) &&
        !said(record.turn, question.completeWhenSaid) &&
        (question.about ?? []).some((word) => said(record.turn, word)),
    );
    const after = records.filter(
      (record) =>
        answered !== undefined &&
        record.atMs > answered.atMs &&
        (!nextWhole || record.atMs < nextWhole.atMs),
    );
    // What the candidate waits, end of question to first line.
    const questionToFirstLineS =
      answered?.firstLineS === undefined || !answered
        ? null
        : (answered.atMs - answered.endedMs) / 1000 + answered.firstLineS;
    // The note for the whole question, with what the coach was given for the
    // call that last wrote it; with no note, what it was given when it acted.
    const written = answered ? notes.get(answered.key) : undefined;
    const given = written?.turn ?? answered?.given;
    const scored =
      scoring && !timingOnly
        ? scoreNote({
            note: written?.note,
            facts: given?.facts ?? [],
            conversation: lines
              .filter((line) => line.seq <= (given?.until ?? 0))
              .map((line) => line.text),
            plan: planText,
            // What the coach was given before this turn, each fact once.
            earlier: [
              ...new Map(
                records
                  .filter((record) => record.given.until < (given?.until ?? 0))
                  .flatMap((record) => record.given.facts)
                  .map((fact) => [fact.pointer, fact] as const),
              ).values(),
            ],
            expectation: expectationOf(question),
            employers,
          })
        : null;
    scores.push(
      scored && {
        evidence: scored.evidence,
        invented: scored.invented,
        right: scored.right,
        grounded: scored.grounded,
        mixed: scored.mixed,
        wrongEmployer: scored.wrongEmployer,
        inferenceOnly: scored.inferenceOnly,
      },
    );
    inventedItems.push(
      scored
        ? [...scored.inventedItems.figures, ...scored.inventedItems.employers]
        : [],
    );
    return {
      id: question.id,
      scenario: question.scenario ?? "",
      optional: question.optional === true,
      // [DOMAIN] Who asked, and who the note for the whole question says
      // asked: null when the note names nobody (or there is no note). A note
      // that names nobody is safe; one that names the wrong person is not.
      askedBy: question.from ?? null,
      notedFrom: (answered && notes.get(answered.key)?.note.from) ?? null,
      answeredWhole: answered !== undefined,
      // Acts on part of the question, and how many of those put a note on screen.
      prematureActs: before.length,
      prematureNotesShown: before.filter(
        (record) => record.firstLineS !== undefined,
      ).length,
      // From the question's last word to acting, on the file's clock.
      toActS: answered ? (answered.atMs - answered.endedMs) / 1000 : null,
      // Real seconds from acting to the first and the last line of the note.
      firstLineS: answered?.firstLineS ?? null,
      finalS: answered?.finalS ?? null,
      questionToFirstLineS,
      nudgesDuringAnswer: after.filter(
        (record) =>
          record.reason === "answer-check" && record.firstLineS !== undefined,
      ).length,
      looksDuringAnswer: after.filter(
        (record) => record.reason === "answer-check",
      ).length,
      otherNotesBeforeNextQuestion: after.filter(
        (record) =>
          record.reason !== "answer-check" && record.firstLineS !== undefined,
      ).length,
      ...(scoring
        ? {
            acted: answered !== undefined,
            // The note's first line was on screen within the threshold of
            // the question's last word. Null: no model wrote notes.
            inTime: timingOnly
              ? null
              : questionToFirstLineS !== null &&
                questionToFirstLineS <= withinS,
            // How many facts the coach was given for the turn.
            factsGiven: given?.facts.length ?? 0,
            note: scores[at] ?? null,
          }
        : {}),
    };
  });
  // [DOMAIN] An act whose turn ends in words that ask the candidate nothing
  // (a handover, "can you hear me?") is a wasted call, and a note shown for
  // it is a distraction.
  const quiet = (expected.quiet ?? []).map((stretch) => {
    const acts = interviewerActs.filter((record) =>
      said(record.turn.slice(-(stretch.said.length + 40)), stretch.said),
    );
    return {
      id: stretch.id,
      acts: acts.length,
      notesShown: acts.filter((record) => record.firstLineS !== undefined)
        .length,
    };
  });
  const runtimeName = timingOnly
    ? "timing"
    : scripted
      ? "scripted"
      : one("--runtime") === "codex"
        ? "codex"
        : "claude";
  // A run without names is its own benchmark: it is compared with the last
  // run without names, never with one where the coach was told who spoke.
  const expectFile = one("--expect") as string;
  const name = `${
    bench ??
    // A call kept as a folder ("tidewell-care/call/expected.json") is named
    // by its folders; a file of its own by its name.
    (basename(expectFile) === "expected.json"
      ? `${basename(dirname(dirname(expectFile)))}-${basename(dirname(expectFile))}`
      : (expectFile
          .split("/")
          .at(-1)
          ?.replace(/\.expected\.json$/, "") as string))
  }${
    // A coach given the pack is its own benchmark, and one given a pack a
    // model prepared another: neither is compared with a coach given a plan.
    material ? (material.kept ? "+kept" : "+pack") : ""
  }${has("--no-names") ? "-unnamed" : ""}${one("--label") ? `@${one("--label")}` : ""}`;
  // How often a note said who asked, of the questions that have an asker and
  // got a note. Counted only when a model wrote notes.
  const noted = timingOnly
    ? []
    : questions.filter(
        (question) => question.askedBy !== null && question.firstLineS !== null,
      );
  const askers = {
    of: noted.length,
    right: noted.filter((question) => question.notedFrom === question.askedBy)
      .length,
    wrong: noted.filter(
      (question) =>
        question.notedFrom !== null && question.notedFrom !== question.askedBy,
    ).length,
    unnamed: noted.filter((question) => question.notedFrom === null).length,
  };
  const result = {
    benchmark: name,
    runtime: runtimeName,
    signals: endpoint || activity ? (detected ? "vad" : "ideal") : "none",
    // What a note may claim, and how a cited claim is checked.
    grounding,
    cite,
    endpoint: endpoint
      ? {
          kind: one("--endpoint-kind") ?? "default",
          owns: has("--endpoint-owns"),
          identity: endpoint.identity ?? null,
        }
      : null,
    at: new Date().toISOString(),
    commit: (() => {
      try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
          encoding: "utf8",
        }).trim();
      } catch {
        return "unknown";
      }
    })(),
    wallSeconds: Math.round((Date.now() - wallStart) / 1000),
    acts: actions,
    callsMadeAgain: counts["recall"] ?? 0,
    notes: notes.size,
    silent: silences,
    failed: records.filter((record) => record.failed).length,
    // Whether the coach was told which interviewer spoke each line.
    names: voices.length > 0,
    askers,
    // [SAFETY] A person's own call: an id and scores for each question, and
    // whether its note named the right asker. Never a name, and never the
    // scenario the expected file describes in words.
    questions: guarded
      ? questions.map((question) => ({
          ...question,
          scenario: "",
          askedBy: null,
          notedFrom: null,
          askerRight:
            question.askedBy === null || question.notedFrom === null
              ? null
              : question.notedFrom === question.askedBy,
        }))
      : questions,
    quiet,
    ...(scoring
      ? {
          guarded,
          withinS,
          // What the coach was given beside the plan.
          material: {
            pack: material !== undefined,
            application: materialFiles.application !== undefined,
            preferences: materialFiles.preferences !== undefined,
            kept: material?.kept !== undefined,
            stage: stageGiven === undefined ? null : Number(stageGiven),
          },
          totals: totalsOf(
            questions.map((question, at) => ({
              optional: question.optional,
              inTime: "inTime" in question ? (question.inTime ?? null) : null,
              note: scores[at] ?? null,
            })),
          ) as NoteTotals,
        }
      : {}),
  };
  const kept = resultsGiven;
  const folder = kept
    ? pathToFileURL(`${kept.replace(/\/$/, "")}/`)
    : new URL("../../../.dev-local/benchmarks/", import.meta.url);
  mkdirSync(folder, { recursive: true });
  const earlier = readdirSync(folder)
    .filter((file) => file.startsWith(`${name}-${runtimeName}-`))
    .sort()
    .at(-1);
  const previous = earlier
    ? (JSON.parse(readFileSync(new URL(earlier, folder), "utf8")) as Omit<
        typeof result,
        "askers" | "totals"
      > & {
        // Absent in a result kept before the coach knew of panels.
        askers?: (typeof result)["askers"];
        // Absent in a result kept before notes were scored.
        totals?: NoteTotals;
      })
    : undefined;
  writeFileSync(
    new URL(
      `${name}-${runtimeName}-${result.at.replace(/[:.]/g, "-")}.json`,
      folder,
    ),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  const show = (value: number | null | boolean) =>
    value === null
      ? "—"
      : typeof value === "number"
        ? String(Math.round(value * 10) / 10)
        : value
          ? "yes"
          : "NO";
  const row = (
    label: string,
    now: number | null | boolean,
    was?: number | null | boolean,
  ) =>
    console.log(
      `  ${label.padEnd(44)} ${show(now).padStart(6)}${was === undefined ? "" : `   (last run: ${show(was)})`}`,
    );
  console.log(
    `\nBENCHMARK ${name} on ${runtimeName} at ${result.commit}${previous ? `, against ${previous.commit} (${previous.at.slice(0, 16)})` : " (first run: nothing to compare with)"}`,
  );
  row("acts", result.acts, previous?.acts);
  row(
    "calls made again (interviewer went on)",
    result.callsMadeAgain,
    previous?.callsMadeAgain,
  );
  row("notes on screen at the end", result.notes, previous?.notes);
  row("calls that said nothing", result.silent, previous?.silent);
  row("calls that failed", result.failed, previous?.failed);
  if (askers.of > 0) {
    row(
      "notes that say who asked, rightly",
      askers.right,
      previous?.askers?.right,
    );
    row(
      "notes that name the WRONG person",
      askers.wrong,
      previous?.askers?.wrong,
    );
    row("notes that name nobody", askers.unnamed, previous?.askers?.unnamed);
  }
  for (const [at, question] of questions.entries()) {
    const was = previous?.questions[at];
    console.log(
      `  ${question.id}${question.scenario && !guarded ? `  (${question.scenario})` : ""}`,
    );
    row(
      "  answered as a whole question",
      question.answeredWhole,
      was?.answeredWhole,
    );
    row("  acts on part of it", question.prematureActs, was?.prematureActs);
    row(
      "  notes shown for part of it",
      question.prematureNotesShown,
      was?.prematureNotesShown,
    );
    if (question.askedBy !== null && question.firstLineS !== null)
      console.log(
        guarded
          ? `    who asked: the note names ${
              question.notedFrom === null
                ? "nobody"
                : question.notedFrom === question.askedBy
                  ? "the right person"
                  : "the WRONG person"
            }`
          : `    asked by ${question.askedBy}; the note says ${question.notedFrom ?? "nobody"}${
              question.notedFrom !== null &&
              question.notedFrom !== question.askedBy
                ? "   WRONG"
                : ""
            }`,
      );
    row("  question end → acting (s)", question.toActS, was?.toActS);
    row(
      "  acting → first line (s, real)",
      question.firstLineS,
      was?.firstLineS,
    );
    row(
      "  question end → first line (s)",
      question.questionToFirstLineS,
      was?.questionToFirstLineS,
    );
    row("  acting → whole note (s, real)", question.finalS, was?.finalS);
    row(
      "  looks during the answer",
      question.looksDuringAnswer,
      was?.looksDuringAnswer,
    );
    row(
      "  nudges during the answer",
      question.nudgesDuringAnswer,
      was?.nudgesDuringAnswer,
    );
    row(
      "  other notes before the next question",
      question.otherNotesBeforeNextQuestion,
      was?.otherNotesBeforeNextQuestion,
    );
  }
  for (const [at, stretch] of result.quiet.entries()) {
    const was = previous?.quiet?.[at];
    console.log(`  ${stretch.id}  (no question for the candidate)`);
    row("  acts on it", stretch.acts, was?.acts);
    row("  notes shown for it", stretch.notesShown, was?.notesShown);
  }
  const asked = result.questions.filter((question) => !question.optional);
  console.log(
    `\n  IN SHORT: ${asked.filter((question) => question.answeredWhole).length} of ${asked.length} questions acted on whole; ${result.questions.reduce((sum, question) => sum + question.prematureActs, 0)} acts on part of a question; ${result.quiet.reduce((sum, stretch) => sum + stretch.acts, 0)} acts on what was no question.${
      askers.of > 0
        ? ` Who asked (${result.names ? "lines named" : "lines not named"}): ${askers.right} of ${askers.of} notes right, ${askers.wrong} wrong, ${askers.unnamed} name nobody.`
        : ""
    }`,
  );

  // ---- What the notes say -------------------------------------------------
  if (scoring && "totals" in result && result.totals) {
    const mark = (value: boolean | null | undefined) =>
      value === null || value === undefined ? "-" : value ? "yes" : "NO";
    const cell = (value: string, width: number) => value.padEnd(width);
    const width = Math.max(
      10,
      ...questions.map((question) => question.id.length + 2),
    );
    console.log(
      `\n  NOTES (a first line is in time within ${withinS} s of the question's last word)`,
    );
    console.log(
      `  ${cell("question", width)}${cell("acted", 7)}${cell("first s", 9)}${cell("in time", 9)}${cell("evidence", 10)}${cell("wrong", 7)}${cell("inferred", 10)}${cell("own", 5)}${cell("unbacked", 10)}${cell("offered", 9)}${cell("invented", 10)}${cell("right", 7)}grounded`,
    );
    for (const [at, question] of questions.entries()) {
      const note = scores[at];
      const judged = note !== null && note !== undefined && note.right !== null;
      console.log(
        `  ${cell(question.id, width)}${cell(mark(question.answeredWhole), 7)}${cell(show(question.questionToFirstLineS), 9)}${cell(mark("inTime" in question ? question.inTime : null), 9)}${cell(judged ? String(note.evidence.accepted) : "-", 10)}${cell(judged ? `${note.evidence.wrong}${note.wrongEmployer ? "!" : ""}` : "-", 7)}${cell(note ? String(note.evidence.inferred) : "-", 10)}${cell(note ? String(note.evidence.own) : "-", 5)}${cell(note ? String(note.evidence.unbacked) : "-", 10)}${cell(judged ? mark(note.evidence.offered) : "-", 9)}${cell(note ? String(note.invented.figures + note.invented.employers) : "-", 10)}${cell(mark(note?.right), 7)}${mark(note?.grounded)}`,
      );
      // Where the note's claims were verified, and (for a fixture of the
      // repository) what it stated that nobody gave it.
      if (note && note.evidence.sources.length > 0)
        console.log(`    verified against ${note.evidence.sources.join(" ")}`);
      if (!guarded && (inventedItems[at] ?? []).length > 0)
        console.log(`    invented: ${(inventedItems[at] ?? []).join(", ")}`);
    }
    console.log(
      "  evidence, wrong: verified claims under an accepted employer's role, and under another's. inferred: claims not verified; own: of those, resting on the person's own notes or plan; unbacked: resting on nothing given or said. offered: the facts the coach was given held an accepted employer's. grounded: no wrong employer, and a claim of an accepted employer's or of the person's own notes.",
    );
    if (previous?.totals)
      console.log(`\n  last run: ${totalsLine(previous.totals)}`);
    console.log(`\n  TOTALS: ${totalsLine(result.totals)}`);
  }
}
await endpoint?.close?.();
process.exit(0);
