// What Settings stored for the behaviour flags, kept in one file: what is set
// is what is read, here and by a new instance over the same file; only a
// flag's own values are ever kept; the environment wins and cannot be
// overwritten; and a file that cannot be written still leaves the value held
// for this process. Every file is under a temporary directory, never the data
// directory.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createBehaviourFlagStore } from "./behaviour-flags";

const VOICE = "ACTIVE_SESSION_VOICE_ACTIVITY";
const COACH = "INTERVIEW_COACH";
const RETAIN = "INTERVIEW_COACH_RETAIN";
const GROUNDING = "INTERVIEW_COACH_GROUNDING";

const directory = mkdtempSync(join(tmpdir(), "behaviour-flags-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let made = 0;
const fresh = () => {
  made += 1;
  return join(directory, `flags-${made}`, "behaviour-flags.json");
};
const values = (store: ReturnType<typeof createBehaviourFlagStore>) =>
  Object.fromEntries(store.list().map((flag) => [flag.key, flag.value]));

describe("the stored behaviour flags", () => {
  it("are the defaults until one is set, and reading them writes nothing", () => {
    const file = fresh();
    const store = createBehaviourFlagStore(file, {});
    expect(store.list()).toEqual([
      {
        key: VOICE,
        value: "off",
        source: "default",
        stored: null,
        default: "off",
      },
      {
        key: COACH,
        value: "off",
        source: "default",
        stored: null,
        default: "off",
      },
      {
        key: RETAIN,
        value: "on",
        source: "default",
        stored: null,
        default: "on",
      },
      {
        key: GROUNDING,
        value: "on",
        source: "default",
        stored: null,
        default: "on",
      },
    ]);
    expect(store.value(VOICE)).toBe("off");
    expect(existsSync(file)).toBe(false);
  });

  it("are what was last set, one flag at a time, read at once by the accessor", () => {
    const store = createBehaviourFlagStore(fresh(), {});
    expect(store.set(VOICE, "on")).toBe("stored");
    expect(store.value(VOICE)).toBe("on");
    expect(store.set(COACH, "codex")).toBe("stored");
    expect(values(store)).toEqual({
      [VOICE]: "on",
      [COACH]: "codex",
      [RETAIN]: "on",
      [GROUNDING]: "on",
    });
    expect(store.set(VOICE, "off")).toBe("stored");
    expect(store.value(VOICE)).toBe("off");
    expect(store.list()[0]).toMatchObject({ source: "setting", stored: "off" });
  });

  it("are written to their file as names and values only, in a folder made for it, with nothing left beside it", () => {
    const file = fresh();
    const store = createBehaviourFlagStore(file, {});
    store.set(VOICE, "on");
    store.set(RETAIN, "off");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      [VOICE]: "on",
      [RETAIN]: "off",
    });
    expect(readdirSync(join(file, ".."))).toEqual(["behaviour-flags.json"]);
  });

  it("survive a new instance reading the file", () => {
    const file = fresh();
    createBehaviourFlagStore(file, {}).set(COACH, "claude");
    expect(createBehaviourFlagStore(file, {}).value(COACH)).toBe("claude");
  });

  it.each([
    ["a flag that is not in the registry", "LOG_CONTENT", "true"],
    ["a value the flag does not allow", COACH, "gemini"],
    ["a value in another case", VOICE, "ON"],
    ["an empty value", RETAIN, ""],
  ])("refuse %s and change nothing", (_name, key, value) => {
    const file = fresh();
    const store = createBehaviourFlagStore(file, {});
    store.set(VOICE, "on");
    const before = readFileSync(file, "utf8");
    expect(store.set(key, value)).toBe("invalid");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(values(store)).toEqual({
      [VOICE]: "on",
      [COACH]: "off",
      [RETAIN]: "on",
      [GROUNDING]: "on",
    });
  });

  it("give way to the environment: the flag reads as the host set it, and Settings may not change it", () => {
    const file = fresh();
    createBehaviourFlagStore(file, {}).set(VOICE, "on");
    const store = createBehaviourFlagStore(file, { [VOICE]: "off" });
    expect(store.value(VOICE)).toBe("off");
    expect(store.list()[0]).toEqual({
      key: VOICE,
      value: "off",
      source: "environment",
      stored: "on",
      default: "off",
    });
    expect(store.set(VOICE, "off")).toBe("environment");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ [VOICE]: "on" });
    // The other flags are still Settings' to change.
    expect(store.set(RETAIN, "off")).toBe("stored");
  });

  it("keep only a flag's own values from a file somebody edited by hand", () => {
    const file = fresh();
    createBehaviourFlagStore(file, {}).set(VOICE, "on");
    writeFileSync(
      file,
      JSON.stringify({
        [VOICE]: "on",
        [COACH]: "gemini",
        [RETAIN]: 7,
        LOG_CONTENT: "true",
      }),
    );
    const store = createBehaviourFlagStore(file, {});
    expect(store.list().map((flag) => flag.stored)).toEqual([
      "on",
      null,
      null,
      null,
    ]);
    store.set(RETAIN, "off");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      [VOICE]: "on",
      [RETAIN]: "off",
    });
  });

  it.each([
    ["is not JSON", "{not json"],
    ["is a list", "[1,2]"],
    ["is null", "null"],
  ])("store nothing when the file %s", (_name, text) => {
    const file = fresh();
    createBehaviourFlagStore(file, {}).set(VOICE, "on");
    writeFileSync(file, text);
    expect(values(createBehaviourFlagStore(file, {}))).toEqual({
      [VOICE]: "off",
      [COACH]: "off",
      [RETAIN]: "on",
      [GROUNDING]: "on",
    });
  });

  it("read their file once: an instance holds what it read or was given", () => {
    const file = fresh();
    const store = createBehaviourFlagStore(file, {});
    store.set(VOICE, "on");
    writeFileSync(file, JSON.stringify({ [VOICE]: "off" }));
    expect(store.value(VOICE)).toBe("on");
  });

  it("still hold the value in memory when the file cannot be written", () => {
    // The folder it wants is a file, so nothing can be made under it.
    const blocker = join(directory, "not-a-folder");
    writeFileSync(blocker, "in the way");
    const file = join(blocker, "behaviour-flags.json");
    const store = createBehaviourFlagStore(file, {});
    expect(() => store.set(VOICE, "on")).not.toThrow();
    expect(store.value(VOICE)).toBe("on");
    expect(readFileSync(blocker, "utf8")).toBe("in the way");
    // It was held by that process only.
    expect(createBehaviourFlagStore(file, {}).value(VOICE)).toBe("off");
  });
});
