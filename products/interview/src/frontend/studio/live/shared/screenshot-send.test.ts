// The "Screenshots to the model" table and the pure rules around it (D35).
import { LIVE_SCREENSHOT_SEND_MODES } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  DECIDED_WHEN_SENT,
  DEFAULT_SCREENSHOT_SEND,
  DEVICE_ONLY_REASON,
  ENDED_REASON,
  latestSent,
  SAVE_FAILED_TEXT,
  SAVE_REFUSED_TEXT,
  SCREENSHOT_SEND_OPTIONS,
  SENT_AS_LABEL,
  savedScreenshotSend,
  screenshotSendDisabledReason,
  screenshotSendFailureText,
  screenshotSendModesCovered,
  screenshotSendTooltip,
  sendsSentence,
  sentByRevisionLine,
  stagedWillBe,
} from "./screenshot-send";
import { sendsLine } from "./screenshot-tray";

describe("the option table", () => {
  it("covers every mode the contract names, once, in order, with the plain descriptions", () => {
    expect(screenshotSendModesCovered()).toBe(true);
    expect(SCREENSHOT_SEND_OPTIONS.map((option) => option.value)).toEqual([
      ...LIVE_SCREENSHOT_SEND_MODES,
    ]);
    expect(
      SCREENSHOT_SEND_OPTIONS.map((o) => [o.label, o.description]),
    ).toEqual([
      [
        "Always send",
        "The screenshot image and the text read from it go to the model.",
      ],
      [
        "Text only when the screen is just text",
        "The image is dropped only when the text was read confidently and covers the screen and it is not code; otherwise the image goes too.",
      ],
      [
        "Never send images",
        "Only the text read from a screenshot goes to the model, when there is any.",
      ],
    ]);
  });

  it("defaults to Always, and a session with no value reads as Always", () => {
    expect(DEFAULT_SCREENSHOT_SEND).toBe("always");
    expect(savedScreenshotSend(null)).toBe("always");
    expect(savedScreenshotSend({})).toBe("always");
    expect(savedScreenshotSend({ screenshotSend: "never" })).toBe("never");
  });
});

describe("why the control cannot change", () => {
  it.each([
    ["device-only", "active", DEVICE_ONLY_REASON],
    ["device-only", "ended", DEVICE_ONLY_REASON],
    ["permitted-remote", "ended", ENDED_REASON],
    ["permitted-remote", "purging", ENDED_REASON],
    ["permitted-remote", "active", null],
    ["permitted-remote", "paused", null],
    [null, null, null],
  ] as const)("%s / %s", (policy, status, reason) => {
    expect(screenshotSendDisabledReason({ policy, status })).toBe(reason);
  });

  it("words a refused save by its closed code", () => {
    expect(screenshotSendFailureText("status_refused")).toBe(SAVE_REFUSED_TEXT);
    expect(screenshotSendFailureText("not_found")).toBe(SAVE_REFUSED_TEXT);
    expect(screenshotSendFailureText("network")).toBe(SAVE_FAILED_TEXT);
  });
});

describe("the tooltip", () => {
  it.each([
    ["always", "Screenshots to the model: Always"],
    ["text-only-when-text", "Screenshots to the model: Text only when text"],
    ["never", "Screenshots to the model: Never"],
  ] as const)("%s", (value, text) => {
    expect(screenshotSendTooltip(value)).toBe(text);
  });
});

describe("what the server recorded, in words", () => {
  it("has exactly the three labels", () => {
    expect(SENT_AS_LABEL).toEqual({
      image: "Image sent",
      "text-only": "Sent as text only",
      none: "Not sent",
    });
  });

  it("labels a screenshot by its newest recorded revision, and says nothing without a record", () => {
    expect(latestSent([])).toBeNull();
    expect(
      latestSent([
        { revision: 1, sent: "image" },
        { revision: 3, sent: "text-only" },
        { revision: 2, sent: "none" },
      ]),
    ).toBe("text-only");
  });

  it("lists each revision's outcome in one line", () => {
    expect(sentByRevisionLine([])).toBeNull();
    expect(
      sentByRevisionLine([
        { revision: 1, sent: "image" },
        { revision: 2, sent: "text-only" },
      ]),
    ).toBe("rev 1: Image sent, rev 2: Sent as text only");
  });
});

describe("what a staged screenshot will do", () => {
  it.each([
    ["always", "unknown", "Will be sent as image"],
    ["always", "none", "Will be sent as image"],
    ["never", "text", "Will be sent as text only"],
    ["never", "none", "Will not be sent"],
    ["never", "unknown", DECIDED_WHEN_SENT],
    ["text-only-when-text", "text", DECIDED_WHEN_SENT],
    ["text-only-when-text", "unknown", DECIDED_WHEN_SENT],
    [null, "text", DECIDED_WHEN_SENT],
  ] as const)("%s with text %s -> %s", (setting, text, line) => {
    expect(stagedWillBe({ setting, text })).toBe(line);
  });
});

describe("the tray sentence follows the setting", () => {
  it.each([
    [2, "always", "Sends 2 screenshots and the text read from them."],
    [1, "always", "Sends 1 screenshot and the text read from it."],
    [3, "never", "Sends the text read from 3 screenshots."],
    [1, "never", "Sends the text read from 1 screenshot."],
    [2, "text-only-when-text", "May send the image or only its text."],
  ] as const)("%i, %s", (count, setting, line) => {
    expect(sendsSentence(count, setting)).toBe(line);
    expect(sendsLine(count, false, setting)).toBe(line);
  });

  it("keeps the device-only and nothing-staged lines whatever the setting", () => {
    expect(sendsLine(2, true, "never")).toMatch(/no screenshot leaves/);
    expect(sendsLine(0, false, "never")).toMatch(/regenerates without/);
    expect(sendsLine(2, false)).toBe(
      "Sends 2 screenshots and the text read from them.",
    );
  });
});
