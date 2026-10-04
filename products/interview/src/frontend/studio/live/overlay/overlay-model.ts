// What the overlay card says, derived from the one session store's snapshot and
// view model. Pure: no fetching, no timers, no React. Everything shown is read
// from the session record, the observations or the actions; nothing is
// invented (a label the read model lacks is left out, not guessed).
import type {
  LiveAction,
  LiveObservation,
  LiveSessionSummary,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import type { IconName } from "../../icon";
import { claimSummary } from "../claim-chips";
import { ageLabel, clockLabel } from "../session-format";
import { formatElapsed } from "../session-merge";
import {
  type AnswerResult,
  type CodeResult,
  parseResultMeta,
  parseSnapshotContent,
} from "../session-results";
import type { ActivityRun } from "../session-runs";
import {
  type CompanionModel,
  SOURCE_LABEL,
  type SourceStatus,
} from "../session-sources";
import type { LiveViewModel } from "../session-state";
import type { TaskView } from "../session-tasks";

// ---- Captures --------------------------------------------------------------

export type Capture = {
  // S1, S2 ...: numbered in arrival order across the session.
  id: string;
  sourceId: string;
  eventId: string;
  // The companion's own label for the captured window (e.g. "Chrome · Tab").
  sourceLabel: string;
  ageText: string;
};

// Screen snapshots with a stored image, oldest first. Only these can be
// analysed (the owner-input route names them by observation id).
export function captureList(
  observations: readonly LiveObservation[],
  serverNowMs: number,
): Capture[] {
  return observations
    .filter(
      (o) => o.kind === "screen.snapshot" && o.screenshotArtifactId !== null,
    )
    .sort((a, b) => a.sequence - b.sequence)
    .map((o, index) => {
      const at = Date.parse(o.receivedAt);
      const label = parseSnapshotContent(o.content.body)?.windowLabel.trim();
      return {
        id: `S${index + 1}`,
        sourceId: o.sourceId,
        eventId: o.eventId,
        sourceLabel: label ? label : SOURCE_LABEL.screen,
        ageText: Number.isNaN(at) ? "" : `${ageLabel(serverNowMs - at)} ago`,
      };
    });
}

// ---- Header ----------------------------------------------------------------

export type StatusChip = {
  tone: "green" | "amber" | "red" | "neutral";
  text: string;
};

export function statusChip(model: LiveViewModel): StatusChip {
  const tone: StatusChip["tone"] =
    model.barState === "live"
      ? "green"
      : model.barState === "paused"
        ? "amber"
        : model.barState === "ended"
          ? "neutral"
          : "red";
  return { tone, text: `${model.barLabel} · ${model.elapsedLabel}` };
}

// The session record has no name of its own, so the title says what kind it is
// and when it started.
export function sessionTitle(
  session: Pick<LiveSessionView, "createdAt" | "rehearsalRunId">,
): string {
  const at = new Date(session.createdAt);
  const time = Number.isNaN(at.getTime())
    ? ""
    : ` · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return `${session.rehearsalRunId ? "Rehearsal" : "Session"}${time}`;
}

export const SOURCE_ICON: Record<string, IconName> = {
  microphone: "mic",
  "application-audio": "graphic_eq",
  screen: "desktop_windows",
};

export type LocalityChips = {
  locality: { icon: IconName; text: string };
  pinned: { text: string; title: string } | null;
};

// "Remote · <profile>" names the execution profile the newest published result
// ran under; without one yet it says only where processing may happen.
// A human label for an execution profile id; unknown ids are shown as given.
const PROFILE_LABEL: Record<string, string> = {
  "interview-session-agent-claude": "Claude (Agent SDK)",
  "interview-session-agent-codex": "Codex",
};
const profileLabel = (id: string): string => PROFILE_LABEL[id] ?? id;

export function localityChips(
  session: LiveSessionView,
  actions: readonly LiveAction[],
): LocalityChips {
  const profile = [...actions]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((action) => parseResultMeta(action.result)?.profileId)
    .find((id): id is string => typeof id === "string");
  return {
    locality:
      session.processingPolicy === "device-only"
        ? { icon: "devices", text: "On this Mac" }
        : {
            icon: "cloud",
            text: profile ? `Remote · ${profileLabel(profile)}` : "Remote",
          },
    pinned: session.profile
      ? {
          text: "Pinned at start",
          title: `Approved experience ${session.profile.id}, revision ${session.profile.revision}, pinned when the session started`,
        }
      : null,
  };
}

// ---- Task ------------------------------------------------------------------

const ownerInputBody = z.object({
  operation: z.enum(["analyze", "follow-up"]),
  target: z.object({ taskId: z.string(), revision: z.number() }).optional(),
  snapshots: z
    .array(z.object({ sourceId: z.string(), eventId: z.string() }))
    .default([]),
});

export type ProvenanceChip = { icon: IconName; label: string };

// Where a task came from: spoken (a question the call raised), a screenshot
// the owner analysed (S<n>), or a typed follow-up. An owner input names its
// own task (`task-i.<request id>`) or the task it targets.
export function provenance(
  task: TaskView,
  observations: readonly LiveObservation[],
  captures: readonly Capture[],
): ProvenanceChip[] {
  const chips: ProvenanceChip[] = [];
  const own = (o: LiveObservation) => task.taskId === `task-i.${o.eventId}`;
  const inputs = observations
    .filter((o) => o.kind === "owner.input")
    .map((o) => ({ o, body: ownerInputBody.safeParse(o.content.body) }))
    .filter(
      (
        entry,
      ): entry is {
        o: LiveObservation;
        body: { success: true; data: z.infer<typeof ownerInputBody> };
      } =>
        entry.body.success &&
        (own(entry.o) || entry.body.data.target?.taskId === task.taskId),
    );
  if (!task.taskId.startsWith("task-i."))
    chips.push({ icon: "hearing", label: "spoken" });
  const shots = new Set<string>();
  let typed = false;
  for (const { body } of inputs) {
    if (body.data.operation === "follow-up") typed = true;
    for (const snap of body.data.snapshots) {
      const capture = captures.find(
        (c) => c.sourceId === snap.sourceId && c.eventId === snap.eventId,
      );
      if (capture) shots.add(capture.id);
    }
  }
  for (const id of shots)
    chips.push({ icon: "screenshot_monitor", label: `${id} screenshot` });
  if (typed) chips.push({ icon: "keyboard", label: "typed" });
  return chips;
}

export type SlotView = {
  name: "ANSWER SLOT" | "CODE SLOT";
  tone: "idle" | "busy" | "ok" | "warn" | "bad";
  text: string;
};

function seconds(run: ActivityRun): string | null {
  const ms = Date.parse(run.updatedAt) - Date.parse(run.createdAt);
  return Number.isNaN(ms) || ms < 0 ? null : (ms / 1000).toFixed(1);
}

export function slotView(
  name: SlotView["name"],
  run: ActivityRun | null,
  applicable: boolean,
): SlotView {
  if (!run)
    return {
      name,
      tone: "idle",
      text: applicable ? "Idle" : "Not needed for this task",
    };
  const took = seconds(run);
  switch (run.state) {
    case "published":
      return {
        name,
        tone: "ok",
        text: `Rev ${run.taskRevision} published${took ? ` · ${took} s` : ""}`,
      };
    case "running":
      return { name, tone: "busy", text: `${run.label}…` };
    case "cancelling":
      return { name, tone: "warn", text: "Cancelling" };
    case "held-conflict":
      return { name, tone: "warn", text: "Held · your edits are kept" };
    case "superseded":
      return {
        name,
        tone: "idle",
        text: `Rev ${run.taskRevision} replaced by a newer revision`,
      };
    case "failed":
      return {
        name,
        tone: "bad",
        text: run.reasonLabel ? `Failed · ${run.reasonLabel}` : "Failed",
      };
    default:
      // discarded, cancelled or refused: settled without publishing.
      return {
        name,
        tone: "warn",
        text: `Suppressed · ${run.reasonLabel ?? run.label}`,
      };
  }
}

// One line of the approach, or one fenced block (shown as code, never with its
// fences).
export type ApproachItem = { kind: "line" | "code"; text: string };

export type Approach = {
  items: ApproachItem[];
  tag: { tone: "ok" | "warn"; text: string };
};

const FENCE = /^\s*(```|~~~)/;

// Splits a draft into lines and fenced code blocks. An unclosed fence runs to
// the end; the fence lines themselves are dropped.
export function approachItems(draft: string): ApproachItem[] {
  const items: ApproachItem[] = [];
  let code: string[] | null = null;
  for (const raw of draft.split("\n")) {
    if (FENCE.test(raw)) {
      if (code) {
        if (code.length > 0)
          items.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    const line = raw.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim();
    if (line !== "") items.push({ kind: "line", text: line });
  }
  if (code && code.length > 0)
    items.push({ kind: "code", text: code.join("\n") });
  return items.slice(0, 12);
}

// The approach is the published answer's own lines, as the server validated
// them; "Validated" only for the current revision's published answer.
export function approach(task: TaskView): Approach | null {
  const answer = task.answer;
  if (!answer || answer.draft.trim() === "") return null;
  const items = approachItems(answer.draft);
  if (items.length === 0) return null;
  const revision =
    [...task.revisions].reverse().find((r) => r.answer)?.revision ??
    task.currentRevision;
  const validated =
    !task.answerStale && task.current.answerRun?.state === "published";
  return {
    items,
    tag: validated
      ? { tone: "ok", text: `Validated · rev ${revision}` }
      : { tone: "warn", text: `Outdated · rev ${revision}` },
  };
}

export type SolutionView = {
  language: string;
  code: string;
  // The whole result (solution, usage, tests and the worker's verification),
  // which the code canvas edits and runs, and the task revision it answers.
  result: CodeResult;
  revision: number | null;
  // One line of status for the collapsed header.
  status: string;
  badges: { ok: boolean; label: string }[];
};

// Only what the server says: "verified" means fullyVerified, never that code
// was generated or that its tests passed.
export function solution(task: TaskView): SolutionView | null {
  const result = task.draftCode ?? task.code;
  if (!result) return null;
  const { states, tests } = result;
  const counts = tests.total > 0 ? ` · ${tests.passed}/${tests.total}` : "";
  return {
    language: result.language,
    code: result.code,
    result,
    revision:
      [...task.revisions].reverse().find((r) => r.code === result)?.revision ??
      null,
    status: states.fullyVerified
      ? "Fully verified"
      : states.testsPassed
        ? "Tests passed, not fully verified"
        : states.generated
          ? "Generated, not verified"
          : "Not generated",
    badges: [
      { ok: states.generated, label: "Generated" },
      { ok: states.testsPassed, label: `Tests passed${counts}` },
      { ok: states.fullyVerified, label: "Fully verified" },
    ],
  };
}

// For a non-coding task: the answer with its claim summary.
export function answerSummary(answer: AnswerResult): string {
  return claimSummary(answer.claimCounts);
}

// ---- Disclosures -----------------------------------------------------------

export type DisclosureRow = { key: string; tag: string; text: string };

export function activityRows(model: LiveViewModel): {
  preview: string;
  rows: DisclosureRow[];
} {
  const last = model.runs.slice(-6);
  return {
    preview: model.activity.text,
    rows: last.map((run) => ({
      key: run.id,
      tag: run.label,
      text: `${run.kindLabel}, task rev ${run.taskRevision}${run.reasonLabel ? `. ${run.reasonLabel}` : ""}`,
    })),
  };
}

// ---- Sessions (the switcher) -------------------------------------------------

export type SessionRow = {
  id: string;
  title: string;
  status: LiveSessionSummary["status"];
  tone: "green" | "amber" | "neutral";
  statusText: string;
  // "12:03": a live session so far, or a finished one's whole length.
  timeText: string;
};

export function sessionRow(
  summary: LiveSessionSummary,
  serverNowMs: number,
): SessionRow {
  const start = Date.parse(summary.createdAt);
  const open = summary.status !== "ended" && summary.status !== "purging";
  const end = summary.endedAt ? Date.parse(summary.endedAt) : serverNowMs;
  const span = Number.isNaN(start) ? 0 : Math.max(0, end - start);
  const tone =
    summary.status === "active"
      ? "green"
      : summary.status === "paused" || summary.status === "created"
        ? "amber"
        : "neutral";
  const statusText =
    summary.status === "active"
      ? "Live"
      : summary.status === "paused"
        ? "Paused"
        : summary.status === "created"
          ? "Waiting"
          : "Ended";
  return {
    id: summary.id,
    title: sessionTitle({
      createdAt: summary.createdAt,
      rehearsalRunId: summary.rehearsal ? "rehearsal" : null,
    }),
    status: summary.status,
    tone,
    statusText,
    timeText: formatElapsed(span),
  };
}

// ---- Companion sources: what each light means --------------------------------

export type SourceAdvice = {
  title: string;
  tone: "green" | "amber" | "red" | "neutral";
  state: string;
  // Why, in the companion's own terms.
  reason: string;
  // What the person can do about it; null when nothing is wrong.
  fix: string | null;
};

const PERMISSION: Record<string, string> = {
  microphone: "Microphone",
  "application-audio": "Screen Recording",
  screen: "Screen Recording",
};

const LOST_REASON: Record<string, Record<string, [string, string]>> = {
  "device-lost": {
    microphone: [
      "The microphone was unplugged or is in use by another app.",
      "Reconnect it or pick another input in the capture companion, then restart capture.",
    ],
    "application-audio": [
      "The app you selected stopped producing audio or quit.",
      "Reopen it, then pick it again in the capture companion.",
    ],
    screen: [
      "Device lost: no on-screen window matched the title you selected.",
      "Open that window again, or pick a window that is on screen, in the capture companion.",
    ],
  },
};

const GAP_REASON: Record<string, string> = {
  "buffer-overflow": "the companion’s buffer overflowed",
  "source-interrupted": "the source was interrupted",
  error: "the companion hit a capture error",
};

export function sourceAdvice(
  status: SourceStatus,
  companion: CompanionModel,
): SourceAdvice {
  const title = `${status.label}${status.source === "screen" ? " (companion)" : ""}`;
  const permission = PERMISSION[status.source] ?? "the required permission";
  switch (status.health) {
    case "receiving":
      return {
        title,
        tone: "green",
        state: "Receiving",
        reason: "Capture is arriving from the companion.",
        fix: null,
      };
    case "not-selected":
      return {
        title,
        tone: "neutral",
        state: "Not part of this session",
        reason: "This source wasn’t turned on when the session started.",
        fix: "Start a new session with it turned on.",
      };
    case "waiting":
      return {
        title,
        tone: "amber",
        state: "Waiting",
        reason:
          companion.status === "never-seen"
            ? "The capture companion hasn’t made contact yet."
            : companion.status === "offline"
              ? `No contact from the companion for ${ageLabel(companion.ageMs ?? 0)}.`
              : "Nothing has arrived from this source yet.",
        fix:
          companion.status === "online"
            ? "Give it a moment. If nothing arrives, restart the companion."
            : "Start the capture companion and pair it with this session (see Details).",
      };
    case "disconnected":
      return {
        title,
        tone: "amber",
        state: "Stopped",
        reason: "You stopped this source in the capture companion.",
        fix: "Start it again from the companion’s menu.",
      };
    case "lost-permission":
      return {
        title,
        tone: "red",
        state: "Permission revoked",
        reason: `macOS no longer lets the capture companion use ${permission}.`,
        fix: `Permission revoked: allow ${permission} for the capture companion in System Settings, then restart it.`,
      };
    case "lost": {
      const known = LOST_REASON[status.reason ?? ""]?.[status.source];
      return {
        title,
        tone: "red",
        state: "Lost",
        reason:
          known?.[0] ?? "Capture stopped after an error in the companion.",
        fix: known?.[1] ?? "Restart the capture companion.",
      };
    }
    case "gap": {
      const why = GAP_REASON[status.reason ?? ""] ?? "capture was interrupted";
      const seconds = status.gapMs
        ? ` for ${Math.round(status.gapMs / 1000)} s`
        : "";
      return {
        title,
        tone: "amber",
        state: "Gap",
        reason: `Audio was dropped${seconds}: ${why}.`,
        fix: "Capture may already be back. If it stays quiet, restart the companion.",
      };
    }
  }
}

// ---- Transcript and chat -------------------------------------------------------

export type ChatEntry = {
  key: string;
  kind: "Dictated" | "Typed" | "Auto";
  text: string;
  at: number;
};
export type ChatRow = { key: string; tag: string; text: string; at: number };

const CHAT_ROWS = 6;

// Spoken (from the companion), dictated and typed lines in the order they
// happened, newest last.
export function chatRows(
  model: LiveViewModel,
  entries: readonly ChatEntry[],
): ChatRow[] {
  const spoken = model.transcript.flatMap((row) =>
    row.type === "utterance" && !row.superseded
      ? [
          {
            key: `s-${row.sourceId}/${row.eventId}`,
            tag: "Spoken",
            text: row.text,
            at: Date.parse(row.receivedAt),
          },
        ]
      : [],
  );
  return [
    ...spoken,
    ...entries.map((entry) => ({
      key: entry.key,
      tag: entry.kind,
      text: entry.text,
      at: entry.at,
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-CHAT_ROWS);
}
