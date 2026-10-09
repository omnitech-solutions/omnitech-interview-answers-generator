// Gives the live coach a transcript to read: a recorder's export, in blocks of
//
//   00:01:12 --> 00:01:19
//   Speaker 1: So tell me about a time you led a migration.
//
//   node scripts/coach-transcript.mjs <file> --interviewer "Speaker 1" --candidate "Speaker 2"
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

const base = (process.env.INTERVIEW_API_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
function token() {
  if (process.env.INTERVIEW_API_TOKEN) return process.env.INTERVIEW_API_TOKEN;
  try {
    return readFileSync(
      new URL("../.dev-local/api-token", import.meta.url),
      "utf8",
    ).trim();
  } catch {
    return "";
  }
}
async function send(method, body) {
  const response = await fetch(`${base}/api/v1/coach-transcript`, {
    method,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(
      `Studio answered ${response.status}: ${answer?.error?.message ?? "the transcript was not accepted"}`,
    );
    process.exit(1);
  }
  return answer;
}

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
if (args.includes("--clear")) {
  await send("DELETE");
  console.log("Transcript cleared.");
  process.exit(0);
}
// The file is the argument that is neither an option nor an option's value.
const VALUED = new Set(["--interviewer", "--candidate", "--speed"]);
const file = args.find(
  (arg, at) => !arg.startsWith("--") && !VALUED.has(args[at - 1]),
);
if (!file) {
  console.error("Give the transcript file, or --clear.");
  process.exit(1);
}
const speakers = {
  ...(option("--interviewer") ? { [option("--interviewer")]: "interviewer" } : {}),
  ...(option("--candidate") ? { [option("--candidate")]: "candidate" } : {}),
};

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
  text: each.text.slice(0, 4000),
  at: new Date(at).toISOString(),
});
if (args.includes("--all")) {
  const first = started - (said.at(-1).endMs - said[0].offsetMs);
  for (let at = 0; at < said.length; at += 500)
    await send("POST", {
      lines: said
        .slice(at, at + 500)
        .map((each) => lineOf(each, first + each.offsetMs - said[0].offsetMs)),
    });
  console.log(`${said.length} lines given to the coach.`);
} else {
  const speed = Math.max(1, Number(option("--speed") ?? "30") || 30);
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
