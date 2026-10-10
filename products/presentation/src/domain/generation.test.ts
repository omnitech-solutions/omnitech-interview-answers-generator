import { expect, it } from "vitest";
import {
  ImageAssetRefusedError,
  outlinePrompt,
  validateImageAssetReference,
} from "./generation";

it("states each supplied option as its own paragraph, in a fixed order", () => {
  expect(
    outlinePrompt({
      prompt: "Quarterly review",
      layout: "pitch",
      scenario: "Board meeting",
      audience: "Executives",
      tone: "Formal",
      textContent: "concise",
      language: "French",
      slideCount: 8,
    }),
  ).toBe(
    [
      "Quarterly review",
      "Create an outline for exactly 8 slides.",
      "Write the outline in French.",
      "Use concise text content.",
      "Tone: Formal.",
      "Audience: Executives.",
      "Scenario: Board meeting.",
      "Use a pitch presentation structure.",
    ].join("\n\n"),
  );
});

it("leaves an automatic or absent option to the model", () => {
  expect(
    outlinePrompt({
      prompt: "Plan",
      tone: "Auto",
      audience: "Auto",
      scenario: "Auto",
      textContent: "",
    }),
  ).toBe("Plan");
});

it.each([
  ["data:image/png;base64,AAAA", false],
  ["https://images.example.test/a.png", false],
  ["http://127.0.0.1:8188/view?filename=a.png", true],
])("accepts %s", (reference, local) => {
  expect(() => validateImageAssetReference(reference, local)).not.toThrow();
});

it.each([
  ["not a url", "Image assets must use an HTTP(S) URL or image data URL."],
  [
    "file:///etc/passwd",
    "Image assets must use an HTTP(S) URL or image data URL.",
  ],
  ["http://localhost/a.png", "Image assets cannot point to loopback hosts."],
  ["http://[::1]/a.png", "Image assets cannot point to loopback hosts."],
])("refuses %s with fixed text", (reference, message) => {
  expect(() => validateImageAssetReference(reference)).toThrow(
    new ImageAssetRefusedError(message),
  );
});
