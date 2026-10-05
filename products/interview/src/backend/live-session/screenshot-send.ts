// What of a task revision's screenshots a model call carries (decision D35):
// applies the owner's stored per-session setting, through the image gate, to
// the screenshots a revision rests on. The server alone decides: the page's
// claim of a setting is never read, and the OCR metrics the page sent are only
// evidence the gate weighs (they were validated and bounded on the way in).
// Everything returned is ids, names, ordinals and closed words, plus the
// machine-read texts the prompt already carries; nothing here is logged.
import type { AgentAttachment } from "@omnitech/ai-contracts";
import type { LiveScreenshotSend } from "@omnitech/interview-contracts";
import { imageGate, type ScreenshotSent } from "./image-gate";
import type { ScreenshotText } from "./screenshot-text";
import { type SessionRun, screenshotTextFor } from "./session-run";

export type ScreenshotOutcome = { ordinal: number; sent: ScreenshotSent };

export type ScreenshotPlan = {
  // The images that travel with the call, named screenshot-1..K in order.
  images: AgentAttachment[];
  // The on-screen texts the prompt carries (image: null when withheld).
  texts: ScreenshotText[];
  // Screenshots whose image was withheld and that have no text to give.
  withheldNoText: string[];
  // What left the device for each screenshot, by S{n} ordinal.
  outcomes: ScreenshotOutcome[];
};

export function planScreenshots(
  run: SessionRun,
  attachments: readonly AgentAttachment[],
  setting: LiveScreenshotSend,
  kind: "permitted-remote" | "device-only",
): ScreenshotPlan {
  // The texts the prompt budget keeps, by S{n} label (a text left out of the
  // prompt cannot stand in for its image).
  const kept = new Map(
    screenshotTextFor(run, attachments).map((entry) => [entry.label, entry]),
  );
  const decided = attachments.map((attachment) => {
    const known = run.snapshots.get(attachment.id);
    const label = known ? `S${known.ordinal}` : undefined;
    let sent = imageGate(setting, known?.ocr, kind).sent;
    // [SAFETY] A frame sent as text alone must have its text in the prompt: if
    // the budget left it out, the image goes instead (never under "never").
    if (sent === "text-only" && (label === undefined || !kept.has(label)))
      sent = setting === "never" ? "none" : "image";
    return { attachment, known, label, sent };
  });
  const images: AgentAttachment[] = [];
  const names = new Map<string, string>();
  for (const entry of decided) {
    if (entry.sent !== "image") continue;
    const name = `screenshot-${images.length + 1}`;
    images.push({ ...entry.attachment, name });
    if (entry.label) names.set(entry.label, name);
  }
  // A kept text is given when its screenshot is not sent as "none".
  const given = new Set(
    decided
      .filter((entry) => entry.sent !== "none" && entry.label !== undefined)
      .map((entry) => entry.label),
  );
  const texts = [...kept.values()]
    .filter((entry) => given.has(entry.label))
    .map((entry) => ({ ...entry, image: names.get(entry.label) ?? null }));
  const withheldNoText = decided
    .filter((entry) => entry.sent === "none" && entry.label !== undefined)
    .map((entry) => entry.label as string);
  return {
    images,
    texts,
    withheldNoText,
    outcomes: decided.flatMap((entry) =>
      entry.known ? [{ ordinal: entry.known.ordinal, sent: entry.sent }] : [],
    ),
  };
}

// Counts of each outcome, for the trace (an enum count, never content).
export function outcomeCounts(outcomes: readonly ScreenshotOutcome[]): {
  screenshotsImage: number;
  screenshotsTextOnly: number;
  screenshotsNone: number;
} {
  const count = (sent: ScreenshotSent) =>
    outcomes.filter((outcome) => outcome.sent === sent).length;
  return {
    screenshotsImage: count("image"),
    screenshotsTextOnly: count("text-only"),
    screenshotsNone: count("none"),
  };
}
