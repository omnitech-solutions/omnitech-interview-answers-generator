// Posts one coach note to the running Studio (the strip under the live
// window's footer), or clears them.
//
//   node scripts/coach-note.mjs '{"title":"…","points":["…"],"links":[{"label":"…","url":"https://…"}]}'
//   node scripts/coach-note.mjs --clear
//
// The token is INTERVIEW_API_TOKEN, or the one `pnpm dev` made in
// .dev-local/api-token. The address is INTERVIEW_API_URL or the local server.
import { coachApi } from "./coach-api.mjs";
import { scriptArgs } from "./script-flags.mjs";

const { positionals, tokens } = scriptArgs(
  { clear: { type: "boolean" } },
  undefined,
  true,
);
const first = tokens[0];
const argument = first?.kind === "option" ? `--${first.name}` : positionals[0];
if (!argument) {
  console.error("Give the note as JSON, or --clear.");
  process.exit(1);
}
const clear = argument === "--clear";
const body = await coachApi(
  clear ? "DELETE" : "POST",
  "/api/v1/coach-notes",
  clear ? undefined : argument,
).catch((error) => {
  if (error.status === undefined) throw error;
  console.error(error.message);
  process.exit(1);
});
console.log(`${body.notes.length} notes (revision ${body.revision})`);
