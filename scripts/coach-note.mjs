// Posts one coach note to the running Studio (the strip under the live
// window's footer), or clears them.
//
//   node scripts/coach-note.mjs '{"title":"…","points":["…"],"links":[{"label":"…","url":"https://…"}]}'
//   node scripts/coach-note.mjs --clear
//
// The token is INTERVIEW_API_TOKEN, or the one `pnpm dev` made in
// .dev-local/api-token. The address is INTERVIEW_API_URL or the local server.
import { readFileSync } from "node:fs";

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

const argument = process.argv[2];
if (!argument) {
  console.error("Give the note as JSON, or --clear.");
  process.exit(1);
}
const clear = argument === "--clear";
const response = await fetch(`${base}/api/v1/coach-notes`, {
  method: clear ? "DELETE" : "POST",
  headers: {
    authorization: `Bearer ${token()}`,
    "content-type": "application/json",
  },
  ...(clear ? {} : { body: argument }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(
    `Studio answered ${response.status}: ${body?.error?.message ?? "the note was not accepted"}${body?.error?.details ? ` (${body.error.details.join(", ")})` : ""}`,
  );
  process.exit(1);
}
console.log(`${body.notes.length} notes (revision ${body.revision})`);
