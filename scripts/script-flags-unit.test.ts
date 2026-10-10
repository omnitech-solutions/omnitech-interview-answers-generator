import { describe, expect, it } from "vitest";
import { parseScriptArgs } from "./script-flags.mjs";

const options = {
  model: { type: "string" },
  speed: { type: "string", multiple: true },
  "no-store": { type: "boolean" },
} as const;

describe("script flags", () => {
  it("keeps absent values undefined so script defaults still apply", () => {
    expect(parseScriptArgs(options, []).values).toEqual({});
  });

  it("keeps the last pack value, repeated transcript values, and boolean flags", () => {
    expect(
      parseScriptArgs(options, [
        "--model",
        "first",
        "--model",
        "last",
        "--speed",
        "20",
        "--speed",
        "30",
        "--no-store",
      ]).values,
    ).toEqual({ model: "last", speed: ["20", "30"], "no-store": true });
  });

  it("refuses a typo with the offending flag in the message", () => {
    expect(() => parseScriptArgs(options, ["--modle", "scripted"])).toThrow(
      "Invalid arguments: Unknown option '--modle'",
    );
  });

  it("refuses a missing option value", () => {
    expect(() => parseScriptArgs(options, ["--model"])).toThrow(
      "argument missing",
    );
  });

  it("validates flags after pnpm's forwarded separator", () => {
    expect(
      parseScriptArgs(options, ["--", "--model", "scripted"]).values.model,
    ).toBe("scripted");
    expect(() =>
      parseScriptArgs(options, ["--", "--modle", "scripted"]),
    ).toThrow("Unknown option '--modle'");
  });

  it("separates the transcript file from option values wherever the flags occur", () => {
    expect(
      parseScriptArgs(
        options,
        ["--speed", "20", "call.txt", "--no-store"],
        true,
      ).positionals,
    ).toEqual(["call.txt"]);
    expect(
      parseScriptArgs(options, ["--", "-call.txt"], true).positionals,
    ).toEqual(["-call.txt"]);
  });
});
