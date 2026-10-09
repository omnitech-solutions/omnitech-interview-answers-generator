// The live coach's ear, for an agent that coaches by hand (Claude Desktop,
// Codex Desktop): it waits until the conversation reaches a moment to act on,
// prints that moment as JSON, and exits. The agent then writes the note
// (`node scripts/coach-note.mjs '<json>'`) and listens again.
//
//   pnpm coach:listen            wait for the next moment (at most 10 minutes)
//   pnpm coach:listen --reset    forget where it had read to, then wait
//
// The Studio decides WHEN (the same turn-taking the built-in coach uses,
// turns.ts); the agent decides WHAT. Running this takes the pen: the built-in
// coach stands by and writes nothing while an agent is listening, and takes
// it back three minutes after the agent's last listen.
//
// What it prints, on one line:
//   { "reason": "question-finished" | "pause" | "speaker-change" | "answer-check",
//     "about": "interviewer" | "candidate",
//     "turn": "the words of the turn to answer",
//     "new": [ { "speaker", "text" } ],          the lines not yet coached
//     "before": [ { "speaker", "text" } ],       the last of the conversation
//     "plan": "the plan for the call, if one is set",
//     "key": "a key for the note, so a second note for this turn replaces the first" }
// Exit 0 with a moment, 2 when nothing happened in time, 1 on an error.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type CoachPorts,
  decide,
  turnsOf,
} from "@omnitech/product-interview/session-worker";
import { coachApi } from "./coach-loop";

type Line = Awaited<
  ReturnType<CoachPorts["transcript"]["since"]>
>["lines"][number];

const STATE = new URL("../../../.dev-local/coach-listen.json", import.meta.url);
const WAIT_MS = 10 * 60_000;
const BEFORE = 40;

const token =
  process.env["INTERVIEW_API_TOKEN"] ??
  readFileSync(
    new URL("../../../.dev-local/api-token", import.meta.url),
    "utf8",
  ).trim();
const api = coachApi(
  process.env["INTERVIEW_API_URL"] ?? "http://127.0.0.1:3000",
  token,
  fetch,
  "desktop-agent",
);

// Where the last listen read to, and when it last acted: kept between runs,
// because each run is one wait.
type State = { epoch: string; readTo: number; actedAtMs: number };
let state: State = { epoch: "", readTo: 0, actedAtMs: 0 };
if (!process.argv.includes("--reset"))
  try {
    state = JSON.parse(readFileSync(STATE, "utf8")) as State;
  } catch {
    // The first listen starts from the beginning of what is held.
  }

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
const started = Date.now();
let lines: Line[] = [];
let cursor = 0;
let lastArrivalMs = Date.now();

try {
  // [DOMAIN] A person who runs this has put an agent in charge: it takes the
  // pen from the built-in coach, and holds it long enough for the agent to
  // think between one listen and the next.
  await api.claim({ takeover: true, leaseSeconds: 180 });
  let renewedAtMs = Date.now();
  while (!stop.signal.aborted && Date.now() - started < WAIT_MS) {
    if (Date.now() - renewedAtMs > 30_000) {
      await api.claim({ takeover: true, leaseSeconds: 180 });
      renewedAtMs = Date.now();
    }
    const read = await api.transcript.since(cursor, stop.signal);
    // A cleared transcript is another conversation.
    if (read.epoch !== state.epoch) {
      state = { epoch: read.epoch, readTo: 0, actedAtMs: 0 };
      if (cursor > 0) {
        cursor = 0;
        lines = [];
        continue;
      }
    }
    if (read.lines.length > 0) {
      // What was already there when listening began is not "just said".
      if (cursor > 0) lastArrivalMs = Date.now();
      lines = [...lines, ...read.lines];
      cursor = read.cursor;
    }
    const fresh = lines.filter((line) => line.seq > state.readTo);
    const decision = decide({
      fresh,
      silenceMs: Date.now() - lastArrivalMs,
      sinceActMs: Date.now() - state.actedAtMs,
    });
    if (decision.action === "act") {
      const stretch = fresh.filter((line) => line.seq <= decision.until);
      const turn = turnsOf(stretch).findLast(
        (each) => each.side === decision.about,
      );
      const plan = await api.plan().catch(() => undefined);
      const from = (stretch[0] as Line).seq;
      console.log(
        JSON.stringify({
          reason: decision.reason,
          about: decision.about,
          turn: turn?.text ?? "",
          new: stretch.map(({ speaker, text }) => ({ speaker, text })),
          before: lines
            .filter((line) => line.seq < from)
            .slice(-BEFORE)
            .map(({ speaker, text }) => ({ speaker, text })),
          ...(plan ? { plan } : {}),
          key: `agent-${state.epoch.slice(0, 8)}-${from}`,
        }),
      );
      // Where it read to is kept for the next listen; a folder that cannot
      // be written only means the next one starts from what is held.
      try {
        mkdirSync(new URL(".", STATE), { recursive: true });
        writeFileSync(
          STATE,
          JSON.stringify({
            epoch: state.epoch,
            readTo: decision.until,
            actedAtMs: Date.now(),
          }),
        );
      } catch {}
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
} catch (error) {
  console.error(
    `The Studio could not be reached (${error instanceof Error ? error.name : "error"}). Is it running?`,
  );
  process.exit(1);
}
process.exit(2);
