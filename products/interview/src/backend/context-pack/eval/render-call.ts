// Renders a fixture's written call (call/scenario.json) into the files a
// benchmark reads: call/transcript.txt and call/expected.json.
//
//   tsx products/interview/src/backend/context-pack/eval/render-call.ts <fixture>
//
// [DOMAIN] Nothing here is random or dated: running it twice writes the same
// bytes. It prints the transcript's SHA-256, which the fixture's stages.json
// names for the transcript it reads from `textFile`.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { type CallScenario, renderCall } from "./call-scenario";

const LINE_WIDTH = 80;

// JSON as the repository's formatter leaves it: an object a line a key, a
// list of plain values on one line when it fits.
function formatted(value: unknown, indent = "", lead = 0): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const plain = value.every(
      (each) => each === null || typeof each !== "object",
    );
    const inline = `[${value.map((each) => JSON.stringify(each)).join(", ")}]`;
    // One more column for the comma that may follow it.
    if (plain && lead + inline.length + 1 <= LINE_WIDTH) return inline;
    return `[\n${value
      .map((each) => `${inner}${formatted(each, inner, inner.length)}`)
      .join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{\n${entries
      .map(([key, each]) => {
        const name = `${inner}${JSON.stringify(key)}: `;
        return `${name}${formatted(each, inner, name.length)}`;
      })
      .join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

const [name] = process.argv.slice(2);
// [GUARD] The fixture is named, and is a folder name, never a path.
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error("usage: render-call.ts <fixture folder name>");
  process.exit(1);
}
const folder = new URL(
  `../../../../fixtures/context-pack/${name}/call/`,
  import.meta.url,
).pathname;
const scenario = JSON.parse(
  readFileSync(`${folder}scenario.json`, "utf8"),
) as CallScenario & { about?: string };

const { transcript, questions } = renderCall(scenario);
const labels = (part: "interviewer" | "me") =>
  Object.keys(scenario.people).filter(
    (label) => scenario.people[label]?.part === part,
  );
const expected = {
  about:
    scenario.about ??
    "A written call rendered as recorder output (eval/call-scenario.ts). Each question names who asks it, the words that complete it as rendered, and when.",
  interviewer: labels("interviewer"),
  me: labels("me"),
  questions,
};
writeFileSync(`${folder}transcript.txt`, transcript);
writeFileSync(`${folder}expected.json`, `${formatted(expected)}\n`);

const fragments = transcript.split("\n\n").filter(Boolean).length;
console.log(
  `${name}: ${fragments} fragments, ${questions.length} questions, ${questions.at(0)?.startsAt ?? "-"} to ${questions.at(-1)?.endsAt ?? "-"}`,
);
console.log(
  `transcript sha256 ${createHash("sha256").update(transcript).digest("hex")}`,
);
