// The session's story for a person watching a local `pnpm dev` (the story
// format of @omnitech/logging): what was decided about what was heard, what
// was answered, what was not. These lines exist ONLY in that format. Every
// other run writes nothing here: the processor's one output stays its id-only
// trace (hardening/canary.test.ts holds it to a silent console), and the
// words ride the `content` field, which the logger drops unless content
// logging is on.
import { createLogger, type LogFields } from "@omnitech/logging";

const log = createLogger({ service: "session" });

export function tellStory(
  level: "info" | "warn",
  event: string,
  fields: LogFields,
): void {
  if (log.config.format !== "story") return;
  log[level](event, fields);
}
