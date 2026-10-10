// The product's behaviour flags: the switches a person may flip in Settings
// instead of only through an environment variable. This one registry says, for
// each flag, its environment name (which is also its key), its allowed values,
// its default, which process reads it and the words shown for it. Validation,
// the Studio's route, the worker's reading of it and the Settings pane are all
// derived from here: adding a flag is adding a row (see
// bionic/briefs/BRIEF-flags-in-settings.md).
//
// [DOMAIN] Precedence, the same for every flag and in every process:
//   1. the environment variable, when the host set it (it wins, and Settings
//      shows the flag as set by the environment, read-only);
//   2. otherwise the value stored from Settings;
//   3. otherwise the host's default for it, where the flag names one
//      (`hostDefaultEnv`: what a launcher such as `pnpm dev` starts with);
//   4. otherwise the flag's own default.
//
// [SAFETY] Only flags whose values are a closed list belong here. Nothing in
// this registry is a secret, a URL, a path or a declaration about where a
// model runs: those stay in the environment.
import { z } from "zod";

export type BehaviourFlagEnvironment = Readonly<
  Record<string, string | undefined>
>;

// Which process reads the flag when it acts on it.
export const BEHAVIOUR_FLAG_PROCESSES = ["studio", "agent-worker"] as const;
export type BehaviourFlagProcess = (typeof BEHAVIOUR_FLAG_PROCESSES)[number];

type FlagShape = {
  // The environment variable, which is also the flag's key everywhere.
  env: string;
  // A launcher's default, used only when nothing is set or stored.
  hostDefaultEnv?: string;
  process: BehaviourFlagProcess;
  // `switch` is on or off; `choice` is one of several named values.
  type: "switch" | "choice";
  values: readonly [string, ...string[]];
  default: string;
  // What a set environment variable means, exactly as the code read it before
  // the flag could be stored (an unrecognised value keeps its old meaning).
  fromEnv(raw: string): string;
  label: string;
  help: string;
  // What each value is called in Settings.
  options: Readonly<Record<string, string>>;
};

const lower = (raw: string) => raw.trim().toLowerCase();

export const BEHAVIOUR_FLAGS = [
  {
    env: "ACTIVE_SESSION_VOICE_ACTIVITY",
    process: "studio",
    type: "switch",
    values: ["off", "on"],
    default: "off",
    fromEnv: (raw) => (raw === "on" ? "on" : "off"),
    label: "Tell the coach who is speaking",
    help: "The Mac app says when the call or your microphone is carrying a voice (never audio or words), so the coach waits while the interviewer is mid-sentence. Never for a device-only session. Applies from the next report; a session that was already told it is off stays quiet until its listening is started again.",
    options: { off: "Off", on: "On" },
  },
  {
    env: "INTERVIEW_COACH",
    hostDefaultEnv: "INTERVIEW_COACH_DEFAULT",
    process: "agent-worker",
    type: "choice",
    values: ["off", "claude", "codex"],
    default: "off",
    fromEnv: (raw) =>
      lower(raw) === "claude" || lower(raw) === "codex" ? lower(raw) : "off",
    label: "Live coach",
    help: "Which coding agent writes the coach's notes during a live session, or none. A device-only session is never read. Applies within a few seconds; changing it during a call restarts the coach, which carries on from its record of the conversation.",
    options: { off: "Off", claude: "Claude Code", codex: "Codex" },
  },
  {
    env: "INTERVIEW_COACH_RETAIN",
    process: "agent-worker",
    type: "switch",
    values: ["on", "off"],
    default: "on",
    fromEnv: (raw) => (lower(raw) === "off" ? "off" : "on"),
    label: "Coach keeps one model session for the call",
    help: "On: the model remembers the conversation and each turn sends only what is new. Off: every note starts from nothing. Applies within a few seconds; changing it during a call restarts the coach.",
    options: { on: "On", off: "Off" },
  },
  {
    env: "INTERVIEW_COACH_GROUNDING",
    process: "agent-worker",
    type: "switch",
    values: ["on", "off"],
    default: "on",
    fromEnv: (raw) => (lower(raw) === "off" ? "off" : "on"),
    label: "Coach keeps to your record and your notes",
    help: "On: a note names the employer of each fact it uses, your own prepared notes are told apart from the employer's material, nothing is said to be missing from your experience, and a claim is marked verified only when the fact it cites says it. Off: the coach as it was before. Applies within a few seconds; changing it during a call restarts the coach.",
    options: { on: "On", off: "Off" },
  },
] as const satisfies readonly FlagShape[];

export type BehaviourFlagDefinition = (typeof BEHAVIOUR_FLAGS)[number];
export type BehaviourFlagKey = BehaviourFlagDefinition["env"];
export type BehaviourFlagValue<K extends BehaviourFlagKey = BehaviourFlagKey> =
  Extract<BehaviourFlagDefinition, { env: K }>["values"][number];

// What Settings stored, by flag. A flag never changed is absent.
export type StoredBehaviourFlags = Partial<Record<BehaviourFlagKey, string>>;

export const BEHAVIOUR_FLAG_SOURCES = [
  "environment",
  "setting",
  "default",
] as const;

// What a flag is right now in the process that answered, and why.
export const behaviourFlagStateSchema = z.strictObject({
  key: z.string(),
  value: z.string(),
  source: z.enum(BEHAVIOUR_FLAG_SOURCES),
  // What Settings holds, whether or not it is the value in force.
  stored: z.string().nullable(),
  // What applies when nothing is set or stored.
  default: z.string(),
});
export type BehaviourFlagState = z.infer<typeof behaviourFlagStateSchema>;

export const behaviourFlagsResponseSchema = z.strictObject({
  flags: z.array(behaviourFlagStateSchema),
});
export type BehaviourFlagsResponse = z.infer<
  typeof behaviourFlagsResponseSchema
>;

// A change from Settings: one flag and one of its allowed values.
export const behaviourFlagInputSchema = z
  .strictObject({ key: z.string(), value: z.string() })
  .refine(({ key, value }) =>
    (behaviourFlag(key)?.values as readonly string[] | undefined)?.includes(
      value,
    ),
  );
export type BehaviourFlagInput = { key: BehaviourFlagKey; value: string };

export function behaviourFlag(
  key: string,
): BehaviourFlagDefinition | undefined {
  return BEHAVIOUR_FLAGS.find((flag) => flag.env === key);
}

const allowed = (flag: BehaviourFlagDefinition, value: string | undefined) =>
  value !== undefined && (flag.values as readonly string[]).includes(value)
    ? value
    : undefined;

// An environment variable left empty is not a choice: `NAME=` in a file says
// nothing, as it always has.
const said = (env: BehaviourFlagEnvironment, name: string | undefined) => {
  const raw = name === undefined ? undefined : env[name];
  return raw !== undefined && raw.trim() !== "" ? raw : undefined;
};

/** One flag's value in force, and where it came from. */
export function resolveBehaviourFlag(
  env: BehaviourFlagEnvironment,
  key: BehaviourFlagKey,
  stored: StoredBehaviourFlags = {},
): BehaviourFlagState {
  const flag = behaviourFlag(key) as BehaviourFlagDefinition;
  const kept = allowed(flag, stored[key]);
  const hostDefault = said(
    env,
    "hostDefaultEnv" in flag ? flag.hostDefaultEnv : undefined,
  );
  const fallback =
    allowed(flag, hostDefault && flag.fromEnv(hostDefault)) ?? flag.default;
  const fromHost = said(env, flag.env);
  const state = { key, stored: kept ?? null, default: fallback };
  if (fromHost !== undefined)
    return { ...state, value: flag.fromEnv(fromHost), source: "environment" };
  if (kept !== undefined) return { ...state, value: kept, source: "setting" };
  return { ...state, value: fallback, source: "default" };
}

/**
 * The typed accessor: a flag's value in force. Call it where the flag is
 * used, not once at start, so a change in Settings needs no restart.
 */
export function behaviourFlagValue<K extends BehaviourFlagKey>(
  env: BehaviourFlagEnvironment,
  key: K,
  stored: StoredBehaviourFlags = {},
): BehaviourFlagValue<K> {
  return resolveBehaviourFlag(env, key, stored).value as BehaviourFlagValue<K>;
}

/** Every flag's state, in registry order. */
export function resolveBehaviourFlags(
  env: BehaviourFlagEnvironment,
  stored: StoredBehaviourFlags = {},
): BehaviourFlagState[] {
  return BEHAVIOUR_FLAGS.map((flag) =>
    resolveBehaviourFlag(env, flag.env, stored),
  );
}

/**
 * The environment a process's flag readers should see: each of its flags that
 * the host did not set is filled in with the stored value (or the default).
 * A variable the host set is passed through untouched, so its reader keeps
 * saying what it always said about a value it does not know.
 */
export function withBehaviourFlags(
  env: BehaviourFlagEnvironment,
  stored: StoredBehaviourFlags,
  process: BehaviourFlagProcess,
): BehaviourFlagEnvironment {
  const filled: Record<string, string | undefined> = { ...env };
  for (const flag of BEHAVIOUR_FLAGS) {
    if (flag.process !== process) continue;
    const state = resolveBehaviourFlag(env, flag.env, stored);
    if (state.source !== "environment") filled[flag.env] = state.value;
  }
  return filled;
}

/** What Settings holds, read out of a response from the Studio. */
export function storedBehaviourFlags(
  response: BehaviourFlagsResponse,
): StoredBehaviourFlags {
  const stored: StoredBehaviourFlags = {};
  for (const state of response.flags) {
    const flag = behaviourFlag(state.key);
    if (flag && state.stored !== null) stored[flag.env] = state.stored;
  }
  return stored;
}
