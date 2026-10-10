// The behaviour flag registry: every flag is a closed list with a default in
// it, the environment wins over what Settings stored, what Settings stored
// wins over the defaults, and each flag's reading of its environment variable
// is exactly what the code read before the flag could be stored.
import { describe, expect, it } from "vitest";
import {
  BEHAVIOUR_FLAG_PROCESSES,
  BEHAVIOUR_FLAGS,
  behaviourFlag,
  behaviourFlagInputSchema,
  behaviourFlagsResponseSchema,
  behaviourFlagValue,
  resolveBehaviourFlag,
  resolveBehaviourFlags,
  storedBehaviourFlags,
  withBehaviourFlags,
} from "./behaviour-flags";

const VOICE = "ACTIVE_SESSION_VOICE_ACTIVITY";
const COACH = "INTERVIEW_COACH";
const RETAIN = "INTERVIEW_COACH_RETAIN";
const GROUNDING = "INTERVIEW_COACH_GROUNDING";

describe("the registry", () => {
  it("names the four flags, each once, by its environment variable", () => {
    expect(BEHAVIOUR_FLAGS.map((flag) => flag.env)).toEqual([
      VOICE,
      COACH,
      RETAIN,
      GROUNDING,
    ]);
  });

  it.each(BEHAVIOUR_FLAGS.map((flag) => [flag.env, flag] as const))(
    "%s is a closed list with its default in it, a label, help and a name for every value",
    (_env, flag) => {
      const values: readonly string[] = flag.values;
      expect(new Set(values).size).toBe(values.length);
      expect(values).toContain(flag.default);
      expect(Object.keys(flag.options).sort()).toEqual([...values].sort());
      expect(flag.label.length).toBeGreaterThan(3);
      expect(flag.help.length).toBeGreaterThan(20);
      expect(BEHAVIOUR_FLAG_PROCESSES).toContain(flag.process);
      expect(flag.type === "switch" ? values.length : 3).toBe(
        flag.type === "switch" ? 2 : values.length,
      );
      // Whatever the host writes, the flag reads one of its own values.
      for (const raw of ["on", "off", "ON", " claude ", "gemini", "1", "true"])
        expect(values).toContain(flag.fromEnv(raw));
    },
  );

  it("keeps every default as it was: voice activity off, no coach, one session kept", () => {
    expect(behaviourFlagValue({}, VOICE)).toBe("off");
    expect(behaviourFlagValue({}, COACH)).toBe("off");
    expect(behaviourFlagValue({}, RETAIN)).toBe("on");
  });

  it("holds the coach to the record and the person's notes unless it is turned off, by the host or in Settings", () => {
    expect(behaviourFlag(GROUNDING)).toMatchObject({
      process: "agent-worker",
      type: "switch",
      values: ["on", "off"],
      default: "on",
    });
    expect(behaviourFlagValue({}, GROUNDING)).toBe("on");
    expect(behaviourFlagValue({ [GROUNDING]: " OFF " }, GROUNDING)).toBe("off");
    // Anything else the host writes is the default, never a third state.
    expect(behaviourFlagValue({ [GROUNDING]: "plain" }, GROUNDING)).toBe("on");
  });

  it("finds a flag by its key and nothing by any other name", () => {
    expect(behaviourFlag(COACH)?.process).toBe("agent-worker");
    expect(behaviourFlag(VOICE)?.process).toBe("studio");
    for (const key of ["", "interview_coach", "LOG_CONTENT", "AI_LOCALITY"])
      expect(behaviourFlag(key)).toBeUndefined();
  });
});

describe("precedence", () => {
  it("is the default when nothing is set or stored", () => {
    expect(resolveBehaviourFlag({}, VOICE)).toEqual({
      key: VOICE,
      value: "off",
      source: "default",
      stored: null,
      default: "off",
    });
  });

  it("is what Settings stored when the environment says nothing", () => {
    expect(resolveBehaviourFlag({}, VOICE, { [VOICE]: "on" })).toEqual({
      key: VOICE,
      value: "on",
      source: "setting",
      stored: "on",
      default: "off",
    });
  });

  it("is the environment's when it is set, whatever Settings stored, and still says what is stored", () => {
    expect(
      resolveBehaviourFlag({ [VOICE]: "off" }, VOICE, { [VOICE]: "on" }),
    ).toEqual({
      key: VOICE,
      value: "off",
      source: "environment",
      stored: "on",
      default: "off",
    });
    expect(
      resolveBehaviourFlag({ [COACH]: "codex" }, COACH, { [COACH]: "off" }),
    ).toMatchObject({ value: "codex", source: "environment" });
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
  ])("treats an %s environment variable as not set", (_name, raw) => {
    expect(
      resolveBehaviourFlag({ [VOICE]: raw }, VOICE, { [VOICE]: "on" }),
    ).toMatchObject({ value: "on", source: "setting" });
    expect(resolveBehaviourFlag({ [RETAIN]: raw }, RETAIN)).toMatchObject({
      value: "on",
      source: "default",
    });
  });

  it("ignores a stored value the flag does not allow", () => {
    expect(
      resolveBehaviourFlag({}, COACH, { [COACH]: "gemini" }),
    ).toMatchObject({ value: "off", source: "default", stored: null });
  });

  it("uses the host's default for the coach only when nothing is set or stored", () => {
    const host = { INTERVIEW_COACH_DEFAULT: "claude" };
    expect(resolveBehaviourFlag(host, COACH)).toMatchObject({
      value: "claude",
      source: "default",
      default: "claude",
    });
    expect(resolveBehaviourFlag(host, COACH, { [COACH]: "off" })).toMatchObject(
      { value: "off", source: "setting", default: "claude" },
    );
    expect(
      resolveBehaviourFlag({ ...host, [COACH]: "codex" }, COACH, {
        [COACH]: "off",
      }),
    ).toMatchObject({ value: "codex", source: "environment" });
    // A host default the flag does not know is no default at all.
    expect(
      resolveBehaviourFlag({ INTERVIEW_COACH_DEFAULT: "gemini" }, COACH),
    ).toMatchObject({ value: "off", default: "off" });
  });
});

describe("each flag reads its environment variable as it always did", () => {
  it("voice activity is on only for exactly `on`", () => {
    for (const raw of ["off", "true", "1", "ON", " on "])
      expect(behaviourFlagValue({ [VOICE]: raw }, VOICE)).toBe("off");
    expect(behaviourFlagValue({ [VOICE]: "on" }, VOICE)).toBe("on");
  });

  it("the coach is claude or codex in any case, and off for anything else", () => {
    expect(behaviourFlagValue({ [COACH]: " Claude " }, COACH)).toBe("claude");
    expect(behaviourFlagValue({ [COACH]: "CODEX" }, COACH)).toBe("codex");
    for (const raw of ["off", " OFF ", "gemini", "on"])
      expect(behaviourFlagValue({ [COACH]: raw }, COACH)).toBe("off");
  });

  it("the coach keeps its session unless told `off`", () => {
    for (const raw of ["on", "yes", "1"])
      expect(behaviourFlagValue({ [RETAIN]: raw }, RETAIN)).toBe("on");
    for (const raw of ["off", " OFF "])
      expect(behaviourFlagValue({ [RETAIN]: raw }, RETAIN)).toBe("off");
  });
});

describe("all flags at once", () => {
  it("answers every flag in registry order, and the answer is the response the Studio sends", () => {
    const flags = resolveBehaviourFlags(
      { [COACH]: "claude" },
      { [VOICE]: "on" },
    );
    expect(flags.map((flag) => [flag.key, flag.value, flag.source])).toEqual([
      [VOICE, "on", "setting"],
      [COACH, "claude", "environment"],
      [RETAIN, "on", "default"],
      [GROUNDING, "on", "default"],
    ]);
    expect(behaviourFlagsResponseSchema.parse({ flags })).toEqual({ flags });
    expect(storedBehaviourFlags({ flags })).toEqual({ [VOICE]: "on" });
  });

  it("reads nothing stored out of a response that names a flag it does not know", () => {
    expect(
      storedBehaviourFlags({
        flags: [
          {
            key: "LOG_CONTENT",
            value: "true",
            source: "setting",
            stored: "true",
            default: "false",
          },
        ],
      }),
    ).toEqual({});
  });
});

describe("the environment a process's readers see", () => {
  it("fills in that process's flags from Settings and leaves the other process's alone", () => {
    const stored = { [VOICE]: "on", [COACH]: "codex", [RETAIN]: "off" };
    expect(withBehaviourFlags({ OTHER: "x" }, stored, "agent-worker")).toEqual({
      OTHER: "x",
      [COACH]: "codex",
      [RETAIN]: "off",
      [GROUNDING]: "on",
    });
    expect(withBehaviourFlags({}, stored, "studio")).toEqual({ [VOICE]: "on" });
  });

  it("passes a variable the host set through untouched, even one the flag does not know", () => {
    expect(
      withBehaviourFlags(
        { [COACH]: "gemini" },
        { [COACH]: "claude" },
        "agent-worker",
      ),
    ).toEqual({ [COACH]: "gemini", [RETAIN]: "on", [GROUNDING]: "on" });
  });

  it("fills in the defaults when nothing is stored", () => {
    expect(
      withBehaviourFlags(
        { INTERVIEW_COACH_DEFAULT: "claude" },
        {},
        "agent-worker",
      ),
    ).toEqual({
      INTERVIEW_COACH_DEFAULT: "claude",
      [COACH]: "claude",
      [RETAIN]: "on",
      [GROUNDING]: "on",
    });
  });
});

describe("a change from Settings", () => {
  const accepts = (input: unknown) =>
    behaviourFlagInputSchema.safeParse(input).success;

  it("is one flag and one of its values", () => {
    for (const flag of BEHAVIOUR_FLAGS)
      for (const value of flag.values)
        expect(accepts({ key: flag.env, value })).toBe(true);
  });

  it.each([
    ["a flag that is not in the registry", { key: "LOG_CONTENT", value: "on" }],
    ["a value the flag does not allow", { key: COACH, value: "gemini" }],
    ["another flag's value", { key: VOICE, value: "claude" }],
    ["a value in another case", { key: VOICE, value: "ON" }],
    ["a boolean", { key: VOICE, value: true }],
    ["no value", { key: VOICE }],
    ["an extra field", { key: VOICE, value: "on", env: "x" }],
    ["nothing", null],
  ])("refuses %s", (_name, input) => {
    expect(accepts(input)).toBe(false);
  });
});
