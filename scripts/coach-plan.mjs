// Sets, shows or clears the plan the live coach is given for a call.
//
//   node scripts/coach-plan.mjs <file.md>     set it from a file
//   node scripts/coach-plan.mjs --show
//   node scripts/coach-plan.mjs --clear
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
  console.error("Give the plan's file, --show or --clear.");
  process.exit(1);
}
const show = argument === "--show";
const response = await fetch(`${base}/api/v1/coach-plan`, {
  method: show ? "GET" : "PUT",
  headers: {
    authorization: `Bearer ${token()}`,
    "content-type": "application/json",
  },
  ...(show
    ? {}
    : {
        body: JSON.stringify({
          text: argument === "--clear" ? "" : readFileSync(argument, "utf8"),
        }),
      }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(
    `Studio answered ${response.status}: ${body?.error?.message ?? "the plan was not accepted"}`,
  );
  process.exit(1);
}
console.log(show ? body.text || "(no plan)" : `Plan set: ${body.text.length} characters.`);
