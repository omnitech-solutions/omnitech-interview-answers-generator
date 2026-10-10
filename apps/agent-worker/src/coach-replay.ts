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
//   --hide-me         the coach does not hear the person being coached
//   --from T --to T   the stretch to replay (HH:MM:SS of the file's clock)
//   --timing          decisions only, no model
//   --latency S       with --timing: how long the absent model takes (default 4)
//   --runtime claude|codex    who writes the notes (default claude)
//   --speed N         N times faster than it was said (default 1). Above 1 a
//                     model's delay looks N times longer than it is.
//   --studio          also show the notes in the running Studio's notes pane,
//                     as replay notes: kept apart from your own, in memory
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
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
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
  type CoachPorts,
  castBlocks,
  createCoach,
  readTranscript,
  type SpeakerRole,
  speakersOf,
  turnsOf,
} from "@omnitech/product-interview/session-worker";
import { coachApi } from "./coach-loop";
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
const one = (name: string) =>
  all(name).at(-1) ??
  (bench === undefined
    ? undefined
    : name === "--expect"
      ? fixture("expected.json")
      : name === "--plan" && existsSync(fixture("plan.md"))
        ? fixture("plan.md")
        : undefined);
const file =
  args.find(
    (arg, at) => !arg.startsWith("--") && !VALUED.has(args[at - 1] ?? ""),
  ) ?? (bench === undefined ? undefined : fixture("transcript.txt"));
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
      `  ${(each.label || "(no label)").padEnd(14)} ${String(each.words).padStart(6)} words in ${String(each.blocks).padStart(4)} pieces   "${short(each.sample, 70)}"`,
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
const speed = timingOnly ? 1 : Math.max(1, Number(one("--speed") ?? "1") || 1);
const first = (heard[0] as (typeof heard)[number]).endMs - 1_000;
const last = (heard.at(-1) as (typeof heard)[number]).endMs;

// The file's clock. Timing only: stepped by hand, as fast as the machine
// goes. With a model: the wall clock, `speed` times faster.
let now = first;
const wallStart = Date.now();
const fileNow = () =>
  timingOnly ? now : first + (Date.now() - wallStart) * speed;

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
const notes = new Map<string, { atMs: number; note: CoachNoteInput }>();
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
    const turn = turnsOf(stretch).findLast((each) =>
      event.reason === "answer-check"
        ? each.side === "candidate"
        : each.side === "interviewer",
    );
    acted.set(event.key, {
      atMs: event.atMs,
      endedMs: ended,
      reason: event.reason ?? "",
    });
    records.push({
      atMs: event.atMs,
      reason: event.reason ?? "",
      key: event.key,
      turn: turn?.text ?? "",
      endedMs: ended,
    });
    say(
      event.atMs,
      `ACT    ${(event.reason ?? "").padEnd(17)} ${wait(event.atMs - ended)} after "${short(turn?.text ?? "", 110)}"`,
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
      for await (const part of engine.stream(input, execution, options)) {
        if (part.type === "text") {
          first ??= Date.now() - began;
          reply += part.text;
        }
        if (part.type === "failed")
          console.log(`──── call ${call}: failed (${part.failure.code}) ────`);
        yield part;
      }
      console.log(
        `──── call ${call}: reply (first text ${first === undefined ? "none" : `${(first / 1000).toFixed(1)}s`}, whole ${((Date.now() - began) / 1000).toFixed(1)}s) ────`,
      );
      console.log(reply.trim() || "(nothing)");
      console.log("────────────────────────────────────────────────────────\n");
    },
  };
}

const coach = createCoach(
  {
    engine: timingOnly ? silent : traced(modelEngine()),
    profileId: "coach",
    transcript: {
      since: async (after) => ({
        epoch: "replay",
        cursor: seq,
        lines: lines.filter((line) => line.seq > after),
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
        });
        await studio?.notes.post(note, signal, "replay");
      },
    },
    ...(planText ? { plan: async () => planText } : {}),
    scope: { tenantId: "local", actorId: "coach-replay" },
    nowMs: fileNow,
    onEvent,
  },
  {
    retain: has("--retain"),
    // The endpoint alone ends the interviewer's turn: nothing is waited after.
    ...(endpoint && has("--endpoint-owns")
      ? { timing: { finishedMs: 0, pauseMs: 0, trailingMs: 0 } }
      : {}),
  },
);

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
console.log(
  `Replaying ${clock(first + 1_000)} to ${clock(last)}: ${heard.length} pieces. ${Object.entries(
    cast,
  )
    .map(([label, role]) => `${label || "(no label)"} = ${role}`)
    .join(", ")}.${
    // A panel: whether the coach is told which interviewer says each line.
    voices.length > 0
      ? ` The coach is told who speaks: ${voices.join(", ")}.`
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
  if (timingOnly) {
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
if (!timingOnly)
  await Promise.race([
    coach.idle(),
    new Promise((resolve) => setTimeout(resolve, 60_000)),
  ]);
await runtime?.close?.();

// ---- What it came to --------------------------------------------------------

if (!timingOnly)
  for (const { atMs, note } of notes.values()) {
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
    }[];
    // Things said that are no question for the candidate.
    quiet?: { id: string; said: string }[];
  };
  const expected = JSON.parse(
    readFileSync(one("--expect") as string, "utf8"),
  ) as Expected;
  const said = (text: string, phrase: string) =>
    text.toLowerCase().includes(phrase.toLowerCase());
  const interviewerActs = records.filter(
    (record) =>
      record.reason !== "answer-check" && record.reason !== "screen-change",
  );
  const questions = expected.questions.map((question, at) => {
    // The acts on this question: those whose turn is about it and that came
    // before the next question was whole.
    const whole = interviewerActs.find((record) =>
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
        (!whole || record.atMs < whole.atMs) &&
        !said(record.turn, question.completeWhenSaid) &&
        (question.about ?? []).some((word) => said(record.turn, word)),
    );
    const after = records.filter(
      (record) =>
        whole !== undefined &&
        record.atMs > whole.atMs &&
        (!nextWhole || record.atMs < nextWhole.atMs),
    );
    return {
      id: question.id,
      scenario: question.scenario ?? "",
      optional: question.optional === true,
      // [DOMAIN] Who asked, and who the note for the whole question says
      // asked: null when the note names nobody (or there is no note). A note
      // that names nobody is safe; one that names the wrong person is not.
      askedBy: question.from ?? null,
      notedFrom: (whole && notes.get(whole.key)?.note.from) ?? null,
      answeredWhole: whole !== undefined,
      // Acts on part of the question, and how many of those put a note on screen.
      prematureActs: before.length,
      prematureNotesShown: before.filter(
        (record) => record.firstLineS !== undefined,
      ).length,
      // From the question's last word to acting, on the file's clock.
      toActS: whole ? (whole.atMs - whole.endedMs) / 1000 : null,
      // Real seconds from acting to the first and the last line of the note.
      firstLineS: whole?.firstLineS ?? null,
      finalS: whole?.finalS ?? null,
      // What the candidate waits, end of question to first line.
      questionToFirstLineS:
        whole?.firstLineS === undefined || !whole
          ? null
          : (whole.atMs - whole.endedMs) / 1000 + whole.firstLineS,
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
    : one("--runtime") === "codex"
      ? "codex"
      : "claude";
  // A run without names is its own benchmark: it is compared with the last
  // run without names, never with one where the coach was told who spoke.
  const name = `${
    bench ??
    ((one("--expect") as string)
      .split("/")
      .at(-1)
      ?.replace(/\.expected\.json$/, "") as string)
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
    questions,
    quiet,
  };
  const kept = all("--results").at(-1);
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
        "askers"
      > & {
        // Absent in a result kept before the coach knew of panels.
        askers?: (typeof result)["askers"];
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
  for (const [at, question] of result.questions.entries()) {
    const was = previous?.questions[at];
    console.log(
      `  ${question.id}${question.scenario ? `  (${question.scenario})` : ""}`,
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
        `    asked by ${question.askedBy}; the note says ${question.notedFrom ?? "nobody"}${
          question.notedFrom !== null && question.notedFrom !== question.askedBy
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
}
await endpoint?.close?.();
process.exit(0);
