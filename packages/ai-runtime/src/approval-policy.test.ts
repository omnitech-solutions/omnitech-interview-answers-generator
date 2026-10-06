import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAgentProfiles } from "./config";

// AN-ERR-01: the Claude runtime maps any approval policy other than "never" to
// permissionMode "default", which asks a person before an unlisted tool runs.
// A worker has nobody to ask, so such a profile would hang unless the runtime
// supplies a permission callback (canUseTool). Codex's adapter denies
// interactive requests itself, but the profiles are shared, so one rule holds.
describe("agent profile approval policy", () => {
  const claudeRuntime = readFileSync(
    new URL("../../agent-runtime-claude/src/index.ts", import.meta.url),
    "utf8",
  );
  const hasPermissionCallback = claudeRuntime.includes("canUseTool");

  it.each(
    [...resolveAgentProfiles({}).values()].map((p) => [p.id, p] as const),
  )("%s never waits for an approval nobody can give", (_id, profile) => {
    if (!hasPermissionCallback) expect(profile.approvalPolicy).toBe("never");
  });
});
