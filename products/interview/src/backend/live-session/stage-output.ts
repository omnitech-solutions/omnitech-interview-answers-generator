// What the assist and coding stages share when they read a model's output: the
// raw value as JSON, and the violations a schema failure is reduced to.
import type { z } from "zod";

// A string is parsed; anything unparseable is `undefined`, which the stage's
// schema then refuses.
export function parseRaw(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

// [SAFETY] Paths and issue codes only: an unrecognised key's NAME is
// model-controlled, so it is counted and never copied.
export function zodViolations(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.map(String).join(".") || "$";
    const count =
      issue.code === "unrecognized_keys" ? `:${issue.keys.length}` : "";
    return `${path}:${issue.code}${count}`;
  });
}
