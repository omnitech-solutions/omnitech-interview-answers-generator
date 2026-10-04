import { LIVE_OWNER_SKILLS } from "@omnitech/interview-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_KEYS,
  COMMANDS,
  claimCommand,
  commandOf,
  cycleSkill,
  INTENT_TARGET,
  intentOf,
  resetCommandClaims,
} from "./commands";

const key = (code: string, shift = false, extra = {}) => ({
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: shift,
  code,
  ...extra,
});

describe("keymap to command", () => {
  it("maps each Alt key to its command, and every command has exactly one key", () => {
    expect(commandOf(key("KeyA", true))).toBe("capture.analyze");
    expect(commandOf(key("KeyR"))).toBe("transcribe.toggle");
    expect(commandOf(key("KeyH", true))).toBe("auto.toggle");
    expect(commandOf(key("KeyS", true))).toBe("solution.generate");
    expect(commandOf(key("BracketRight"))).toBe("skill.next");
    expect(commandOf(key("BracketLeft"))).toBe("skill.prev");
    expect(commandOf(key("KeyC", true))).toBe("session.clear");
    expect(commandOf(key("KeyP", true))).toBe("panel.toggle");
    expect(COMMAND_KEYS.map((each) => each.command).sort()).toEqual(
      [...COMMANDS].sort(),
    );
    expect(new Set(COMMAND_KEYS.map((each) => each.keys)).size).toBe(
      COMMANDS.length,
    );
  });

  it("ignores plain keys, Ctrl or Meta, wrong Shift and IME composition", () => {
    expect(commandOf({ ...key("KeyA", true), altKey: false })).toBeNull();
    expect(commandOf(key("KeyA", true, { metaKey: true }))).toBeNull();
    expect(commandOf(key("KeyA", true, { ctrlKey: true }))).toBeNull();
    expect(commandOf(key("KeyA", false))).toBeNull();
    expect(commandOf(key("KeyA", true, { isComposing: true }))).toBeNull();
    expect(commandOf(key("KeyZ"))).toBeNull();
  });
});

describe("host intents", () => {
  it("accepts the dotted command names and the original capture-analyze", () => {
    for (const command of COMMANDS)
      expect(intentOf(command)).toEqual({ kind: "command", command });
    expect(intentOf("capture-analyze")).toEqual({
      kind: "command",
      command: "capture.analyze",
    });
  });
  it("sets a skill by id, or none by auto, and refuses unknown names", () => {
    expect(intentOf("skill.set:dsa")).toEqual({ kind: "skill", skill: "dsa" });
    expect(intentOf("skill.set:auto")).toEqual({
      kind: "skill",
      skill: undefined,
    });
    expect(intentOf("skill.set:wizardry")).toBeNull();
    expect(intentOf("rm -rf")).toBeNull();
  });
  it("routes capture and solve to analysis, the mic to chat, auto to the pill, and the rest to every panel", () => {
    expect(INTENT_TARGET).toEqual({
      "capture.analyze": "analysis",
      "solution.generate": "analysis",
      "transcribe.toggle": "chat",
      "auto.toggle": "pill",
    });
    expect(INTENT_TARGET["skill.next"]).toBeUndefined();
    expect(INTENT_TARGET["session.clear"]).toBeUndefined();
  });
});

describe("skills", () => {
  it("cycles through every skill and auto, both ways", () => {
    expect(cycleSkill(undefined, 1)).toBe(LIVE_OWNER_SKILLS[0]);
    expect(cycleSkill(LIVE_OWNER_SKILLS.at(-1), 1)).toBeUndefined();
    expect(cycleSkill(undefined, -1)).toBe(LIVE_OWNER_SKILLS.at(-1));
    expect(cycleSkill(LIVE_OWNER_SKILLS[1], -1)).toBe(LIVE_OWNER_SKILLS[0]);
  });
});

describe("one run per press", () => {
  beforeEach(() => {
    resetCommandClaims();
    vi.useRealTimers();
  });
  it("grants a command once per window, and different commands independently", async () => {
    expect(await claimCommand("auto.toggle")).toBe(true);
    expect(await claimCommand("auto.toggle")).toBe(false);
    expect(await claimCommand("skill.next")).toBe(true);
  });
});
