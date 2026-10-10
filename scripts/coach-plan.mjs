// Sets, shows or clears the plan the live coach is given for a call.
//
//   node scripts/coach-plan.mjs <file.md>     set it from a file
//   node scripts/coach-plan.mjs --show
//   node scripts/coach-plan.mjs --clear
//
// The token is INTERVIEW_API_TOKEN, or the one `pnpm dev` made in
// .dev-local/api-token. The address is INTERVIEW_API_URL or the local server.
import { readFileSync } from "node:fs";
import { coachApi } from "./coach-api.mjs";
import { scriptArgs } from "./script-flags.mjs";

const { positionals, tokens } = scriptArgs(
  { show: { type: "boolean" }, clear: { type: "boolean" } },
  undefined,
  true,
);
const first = tokens[0];
const argument = first?.kind === "option" ? `--${first.name}` : positionals[0];
if (!argument) {
  console.error("Give the plan's file, --show or --clear.");
  process.exit(1);
}
const show = argument === "--show";
const body = await coachApi(
  show ? "GET" : "PUT",
  "/api/v1/coach-plan",
  show
    ? undefined
    : {
        text: argument === "--clear" ? "" : readFileSync(argument, "utf8"),
      },
).catch((error) => {
  if (error.status === undefined) throw error;
  console.error(error.message);
  process.exit(1);
});
console.log(
  show ? body.text || "(no plan)" : `Plan set: ${body.text.length} characters.`,
);
