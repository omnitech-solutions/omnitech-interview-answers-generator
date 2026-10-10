import { readFileSync } from "node:fs";

const base = (process.env.INTERVIEW_API_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const refusals = {
  "/api/v1/coach-notes": "the note was not accepted",
  "/api/v1/coach-plan": "the plan was not accepted",
  "/api/v1/coach-transcript": "the transcript was not accepted",
};

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

// A note is already JSON text; plan and transcript callers give objects.
export async function coachApi(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details =
      path === "/api/v1/coach-notes" && answer?.error?.details
        ? ` (${answer.error.details.join(", ")})`
        : "";
    throw Object.assign(
      new Error(
        `Studio answered ${response.status}: ${answer?.error?.message ?? refusals[path]}${details}`,
      ),
      {
        status: response.status,
        code: answer?.error?.code,
      },
    );
  }
  return answer;
}
