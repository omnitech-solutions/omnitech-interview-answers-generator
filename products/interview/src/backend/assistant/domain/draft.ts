import { createHash } from "node:crypto";
import type { InterviewDraft, RunSummary } from "../workspace-contracts";

// The Workspace draft's rules, with no I/O.

// A question's title in the lists: its first non-empty line, bounded.
export function draftTitle(question: string): string {
  const line =
    question
      .split("\n")
      .map((text) => text.trim())
      .find(Boolean) ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

// [DOMAIN] A draft is saved only with an answer or a briefing, and a briefing
// only when every question has an answer and no talking point is blank.
export function saveRefusal(
  value: Pick<InterviewDraft, "answer" | "briefing">,
): "answer-required" | "briefing-incomplete" | null {
  if (!value.answer && !value.briefing) return "answer-required";
  if (
    value.briefing &&
    (!value.briefing.questions.length ||
      value.briefing.questions.some(
        (question) =>
          !question.answerMarkdown.trim() ||
          question.talkingPoints.some((point) => !point.trim()),
      ))
  )
    return "briefing-incomplete";
  return null;
}

// The outcome of a stored run's execution, as the lists show it.
export function runSummary(execution: unknown, at: string): RunSummary | null {
  const run = execution as {
    exitCode?: number | null;
    timedOut?: boolean;
    tests?: { status?: string }[];
  } | null;
  if (!run || typeof run !== "object") return null;
  const tests = Array.isArray(run.tests) ? run.tests : null;
  return {
    ok: run.exitCode === 0 && run.timedOut !== true,
    passed: tests
      ? tests.filter((test) => test.status === "passed").length
      : null,
    total: tests ? tests.length : null,
    at,
  };
}

// Key order never changes a payload's fingerprint.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export const fingerprintOf = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export const textMatchesHash = (text: string, sha256: string) =>
  fingerprintOf(text) === sha256;
