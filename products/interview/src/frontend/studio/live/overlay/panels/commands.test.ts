import { LIVE_OWNER_SKILLS } from "@omnitech/interview-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_KEYS,
  COMMANDS,
  claimCommand,
  commandOf,
  commandOfHotkey,
  cycleSkill,
  INTENT_TARGET,
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
    expect(commandOf(key("KeyF", true))).toBe("chat.focus");
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
  it("accepts the dotted command names, chat.focus among them, and the original capture-analyze", () => {
    for (const command of COMMANDS)
      expect(commandOfHotkey(command)).toBe(command);
    expect(commandOfHotkey("chat.focus")).toBe("chat.focus");
    expect(commandOfHotkey("capture-analyze")).toBe("capture.analyze");
  });
  it("refuses unknown names, and no longer sets a skill by name (the page owns it)", () => {
    expect(commandOfHotkey("skill.set:dsa")).toBeNull();
    expect(commandOfHotkey("rm -rf")).toBeNull();
  });
  it("routes capture, solve, the mic and auto to the always-open bar, and the rest to every panel", () => {
    expect(INTENT_TARGET).toEqual({
      "capture.analyze": "pill",
      "solution.generate": "pill",
      "transcribe.toggle": "pill",
      "auto.toggle": "pill",
    });
    expect(INTENT_TARGET["skill.next"]).toBeUndefined();
    expect(INTENT_TARGET["session.clear"]).toBeUndefined();
  });
});

describe("skills", () => {
  it("cycles through the nine skills both ways, from DSA when none is chosen", () => {
    expect(cycleSkill(undefined, 1)).toBe("system-design");
    expect(cycleSkill(undefined, -1)).toBe("programming");
    expect(cycleSkill(LIVE_OWNER_SKILLS.at(-1), 1)).toBe(LIVE_OWNER_SKILLS[0]);
    expect(cycleSkill(LIVE_OWNER_SKILLS[0], -1)).toBe(LIVE_OWNER_SKILLS.at(-1));
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
