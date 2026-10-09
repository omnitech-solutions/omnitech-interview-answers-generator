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
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
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
]);
const all = (name: string): string[] =>
  args.flatMap((arg, at) =>
    arg === name ? (args[at + 1] ?? "").split(",").map((v) => v.trim()) : [],
  );
const one = (name: string) => all(name).at(-1);
const has = (name: string) => args.includes(name);
const file = args.find(
  (arg, at) => !arg.startsWith("--") && !VALUED.has(args[at - 1] ?? ""),
);
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
  ...(clockMs(one("--from")) === undefined
    ? {}
    : { fromMs: clockMs(one("--from")) as number }),
  ...(clockMs(one("--to")) === undefined
    ? {}
    : { toMs: clockMs(one("--to")) as number }),
});
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
    (heard[next] as (typeof heard)[number]).endMs <= fileNow()
  ) {
    const block = heard[next] as (typeof heard)[number];
    next += 1;
    seq += 1;
    bySeq.set(seq, block);
    lines.push({
      seq,
      speaker: block.speaker,
      text: block.text,
      at: new Date(block.endMs).toISOString(),
    });
  }
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
    say(
      event.atMs,
      `ACT    ${(event.reason ?? "").padEnd(17)} ${wait(event.atMs - ended)} after "${short(turn?.text ?? "", 110)}"`,
    );
  } else if (event.what === "recall") {
    counts["recall"] = (counts["recall"] ?? 0) + 1;
    say(
      event.atMs,
      "AGAIN  the interviewer went on: the call is made again with the whole turn",
    );
  } else if (event.what === "silent") {
    const held = acted.get(event.key);
    if (held) held.silent = true;
    silences += 1;
    if (!timingOnly) say(event.atMs, "       (nothing worth a note)");
  } else if (event.what === "failed") {
    say(event.atMs, "FAILED the call did not finish");
  } else if (event.what === "note") {
    // The first line of the note this act led to, in real seconds.
    if (lastAct && !lastAct.noted) {
      lastAct.noted = true;
      const delay = (event.atMs - lastAct.atMs) / speed;
      firstLines.push(delay);
      say(
        event.atMs,
        `NOTE   first line ${wait(delay)} after acting (real time)`,
      );
    }
  }
}

// The plan for the call, from a file, as the person would have written it.
const planText = one("--plan")
  ? readFileSync(one("--plan") as string, "utf8")
  : undefined;
const coach = createCoach({
  engine: timingOnly ? silent : modelEngine(),
  profileId: "coach",
  transcript: {
    since: async (after) => ({
      epoch: "replay",
      cursor: seq,
      lines: lines.filter((line) => line.seq > after),
    }),
  },
  notes: {
    post: async (note, signal) => {
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
});

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
console.log(
  `Replaying ${clock(first + 1_000)} to ${clock(last)}: ${heard.length} pieces. ${Object.entries(
    cast,
  )
    .map(([label, role]) => `${label || "(no label)"} = ${role}`)
    .join(", ")}.`,
);
// The coach hears a little past the last word, as it would in the room.
const end = last + 10_000;
while (fileNow() < end && !stop.signal.aborted) {
  feed();
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
    console.log(`\n${clock(atMs)}  ${note.kind}: ${note.ask ?? note.title}`);
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
process.exit(0);
