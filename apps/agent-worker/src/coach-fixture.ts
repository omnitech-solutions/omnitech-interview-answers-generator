// Writes a call fixture's transcript from its script.
//
//   pnpm coach:fixture panel-round
//
// A fixture is a folder under fixtures/calls/. One that has a script.json has
// its transcript.txt made from it here; a test fails when the two differ.
import { readFileSync, writeFileSync } from "node:fs";
import { type CallScript, transcriptOf, utterancesOf } from "./call-script";

const name = process.argv[2];
if (!name) {
  console.error("Name the fixture: a folder under fixtures/calls/.");
  process.exit(1);
}
const folder = new URL(`../fixtures/calls/${name}/`, import.meta.url);
const script = JSON.parse(
  readFileSync(new URL("script.json", folder), "utf8"),
) as CallScript;
const opening = script.opening
  ? readFileSync(new URL(script.opening.file, folder), "utf8")
  : "";
writeFileSync(new URL("transcript.txt", folder), transcriptOf(script, opening));
const said = utterancesOf(script);
const two = (n: number) => String(n).padStart(2, "0");
const endMs = said.at(-1)?.endMs ?? 0;
console.log(
  `${name}: ${said.length} scripted pieces, ending at ${two(Math.floor(endMs / 3_600_000))}:${two(Math.floor(endMs / 60_000) % 60)}:${two(Math.floor(endMs / 1000) % 60)}`,
);
