// Gives the live coach a transcript to read: a recorder's export, in blocks of
//
//   00:01:12 --> 00:01:19
//   Speaker 1: So tell me about a time you led a migration.
//
//   node scripts/coach-transcript.mjs <file> --interviewer "Speaker 1" --candidate "Speaker 2"
//   node scripts/coach-transcript.mjs <file> --interviewer "Priya,Marcus,Tom" --candidate "Me"
//                                                            a panel: each interviewer's lines carry their name
//   node scripts/coach-transcript.mjs <file> --speed 20      replayed, 20x faster than it was said
//   node scripts/coach-transcript.mjs <file> --all           the whole of it at once
//   node scripts/coach-transcript.mjs --clear
//
// Replayed is the default (--speed 30), so the coach writes its notes as it
// would have in the room. The transcript is held in the running Studio's
// memory only. The token is INTERVIEW_API_TOKEN, or the one `pnpm dev` made in
// .dev-local/api-token. The address is INTERVIEW_API_URL or the local server.
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { coachApi } from "./coach-api.mjs";
import { scriptArgs } from "./script-flags.mjs";

const { values: flags, positionals } = scriptArgs(
  {
    interviewer: { type: "string", multiple: true },
    candidate: { type: "string", multiple: true },
    speed: { type: "string", multiple: true },
    all: { type: "boolean" },
    clear: { type: "boolean" },
  },
  undefined,
  true,
);
async function send(method, body) {
  return coachApi(method, "/api/v1/coach-transcript", body).catch((error) => {
    if (error.status === undefined) throw error;
    console.error(error.message);
    process.exit(1);
  });
}

if (flags.clear) {
  await send("DELETE");
  console.log("Transcript cleared.");
  process.exit(0);
}
const file = positionals[0];
if (!file) {
  console.error("Give the transcript file, or --clear.");
  process.exit(1);
}
// A panel: --interviewer may name several labels ("Priya,Marcus,Tom"). Each
// of their lines then carries its label as the speaker's name, because the
// recorder told those voices apart. With one interviewer no name is sent.
const interviewers = (flags.interviewer?.[0] ?? "")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
const speakers = {
  ...Object.fromEntries(interviewers.map((label) => [label, "interviewer"])),
  ...(flags.candidate?.[0] ? { [flags.candidate?.[0]]: "candidate" } : {}),
};
const NAME = /^\p{L}[\p{L}\p{N} .'’-]{0,39}$/u;
const nameOf = (label) =>
  interviewers.length > 1 && interviewers.includes(label) && NAME.test(label)
    ? { name: label }
    : {};

// The same reading as the Studio's own parser (coach-transcript.ts): a time
// line sets the offset, a "Label: text" line is something said, and
// consecutive blocks by one speaker are one thing said.
const TIMING = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,]\d+)?\s*-->/;
// A speaker's label is a name and a colon, then a space: an address or a
// clock time at the start of a line is not one.
const SPOKEN = /^([A-Za-z][^:/]{0,39}):(?:\s+|$)(.*)$/;
const said = [];
let offsetMs = 0;
// Only the first line of a block can name its speaker.
let opens = true;
for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line) continue;
  const timing = TIMING.exec(line);
  if (timing) {
    opens = true;
    offsetMs =
      (Number(timing[1]) * 3600 + Number(timing[2]) * 60 + Number(timing[3])) *
      1000;
    continue;
  }
  const last = said.at(-1);
  const spoken = opens ? SPOKEN.exec(line) : null;
  opens = false;
  const label = spoken?.[1]?.trim() ?? last?.label ?? "";
  const text = (spoken ? spoken[2] : line).trim();
  if (!text) continue;
  if (last && last.label === label && last.text.length + text.length < 1200) {
    last.text = `${last.text} ${text}`;
    last.endMs = offsetMs;
    continue;
  }
  said.push({ label, text, offsetMs, endMs: offsetMs });
}
if (said.length === 0) {
  console.error("Nothing said was found in that file.");
  process.exit(1);
}

const started = Date.now();
const lineOf = (each, at) => ({
  speaker: speakers[each.label] ?? "unknown",
  ...nameOf(each.label),
  text: each.text.slice(0, 4000),
  at: new Date(at).toISOString(),
});
if (flags.all) {
  const first = started - (said.at(-1).endMs - said[0].offsetMs);
  for (let at = 0; at < said.length; at += 500)
    await send("POST", {
      lines: said
        .slice(at, at + 500)
        .map((each) => lineOf(each, first + each.offsetMs - said[0].offsetMs)),
    });
  console.log(`${said.length} lines given to the coach.`);
} else {
  const speed = Math.max(1, Number(flags.speed?.[0] ?? "30") || 30);
  console.log(
    `Replaying ${said.length} lines at ${speed}x (about ${Math.ceil((said.at(-1).endMs - said[0].offsetMs) / speed / 60_000)} min). Ctrl-C stops.`,
  );
  for (const each of said) {
    // Each line arrives when its speaker finished it.
    const due = started + (each.endMs - said[0].offsetMs) / speed;
    if (due > Date.now()) await wait(due - Date.now());
    await send("POST", { lines: [lineOf(each, Date.now())] });
  }
  console.log("Replay finished.");
}
