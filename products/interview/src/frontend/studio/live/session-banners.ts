// What the session tells the owner about itself: banners in priority order, one
// line of current activity, the processing-locality indicator and the duration
// cap. Pure. Viewing an earlier task is a UI-local state, not derived here.
import type {
  LiveCaptureSource,
  LiveProcessingPolicy,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { isRunInFlight } from "./session-runs";
import { type CompanionModel, type SourceStatus } from "./session-sources";
import type { TaskView } from "./session-tasks";

// Within this long of the duration cap, the owner is told it is coming.
export const CAP_NEAR_MS = 10 * 60 * 1000;

export type BannerKind =
  | "paused"
  | "permission-revoked"
  | "companion-offline"
  | "source-lost"
  | "gap"
  | "credential-expired"
  | "credential-revoked"
  | "credential-expiring"
  | "cap-near"
  | "cap-reached";

export type Banner = {
  kind: BannerKind;
  tone: "amber" | "red";
  // The source a source banner is about.
  source?: LiveCaptureSource;
  // When the problem began (server time), for "disconnected 2 min ago".
  since?: string | null;
  durationMs?: number | null;
  // companion-offline: true when the server has never recorded contact, which
  // is different from contact that went quiet.
  neverSeen?: boolean;
  // cap-near: how long is left.
  remainingMs?: number;
};

export type CapModel = {
  remainingMs: number | null;
  near: boolean;
  reached: boolean;
};

export function capModel(
  session: LiveSessionView,
  serverNowMs: number,
): CapModel {
  const end = Date.parse(session.expiresAt);
  if (Number.isNaN(end))
    return { remainingMs: null, near: false, reached: false };
  const remainingMs = end - serverNowMs;
  return {
    remainingMs: Math.max(0, remainingMs),
    near: remainingMs > 0 && remainingMs <= CAP_NEAR_MS,
    reached: remainingMs <= 0,
  };
}

// Priority order: paused, permission revoked, companion offline, source lost,
// gap, credential, then the cap. Only an open session has banners.
export function deriveBanners(
  session: LiveSessionView,
  sources: readonly SourceStatus[],
  companion: CompanionModel,
  cap: CapModel,
): Banner[] {
  const open = session.status !== "ended" && session.status !== "purging";
  if (!open) return [];
  const banners: Banner[] = [];
  if (session.status === "paused")
    banners.push({ kind: "paused", tone: "amber" });
  for (const s of sources)
    if (s.health === "lost-permission")
      banners.push({
        kind: "permission-revoked",
        tone: "red",
        source: s.source,
        since: s.since,
      });
  // Quiet or absent contact matters while capture should be happening.
  if (session.status !== "paused" && companion.status !== "online")
    banners.push({
      kind: "companion-offline",
      tone: companion.status === "offline" ? "red" : "amber",
      neverSeen: companion.status === "never-seen",
      since: companion.lastContactAt,
    });
  for (const s of sources)
    if (s.health === "disconnected" || s.health === "lost")
      banners.push({
        kind: "source-lost",
        tone: "red",
        source: s.source,
        since: s.since,
      });
  for (const s of sources)
    if (s.health === "gap")
      banners.push({
        kind: "gap",
        tone: "amber",
        source: s.source,
        since: s.since,
        durationMs: s.gapMs,
      });
  if (companion.credential === "expired")
    banners.push({ kind: "credential-expired", tone: "red" });
  else if (companion.credential === "revoked")
    banners.push({ kind: "credential-revoked", tone: "red" });
  else if (companion.credential === "expiring-soon")
    banners.push({ kind: "credential-expiring", tone: "amber" });
  if (cap.reached) banners.push({ kind: "cap-reached", tone: "red" });
  else if (cap.near)
    banners.push({
      kind: "cap-near",
      tone: "amber",
      remainingMs: cap.remainingMs ?? 0,
    });
  return banners;
}

// ---- Activity ----------------------------------------------------------------

export type ActivityKey =
  | "ended"
  | "paused"
  | "source-lost"
  | "coding-draft"
  | "agent-working"
  | "reading-coding-task"
  | "drafting"
  | "code-ready"
  | "answer-ready"
  | "companion-waiting"
  | "companion-offline"
  | "listening";

export type Activity = { key: ActivityKey; text: string };

const REVOKED_LABEL = "permission revoked";

// By priority: paused; a lost source; a coding draft in flight; the coding
// task being read; an answer being drafted; a result ready (until the
// conversation moves on); no companion contact; and otherwise listening.
export function deriveActivity(input: {
  session: LiveSessionView;
  sources: readonly SourceStatus[];
  companion: CompanionModel;
  tasks: readonly TaskView[];
  // Server time of the newest transcript line, if any.
  lastUtteranceAt: string | null;
}): Activity {
  const { session, sources, companion, tasks } = input;
  if (session.status === "ended" || session.status === "purging")
    return { key: "ended", text: "Ended" };
  if (session.status === "paused") return { key: "paused", text: "Paused" };
  const lost = sources.find((s) => s.lost);
  if (lost)
    return {
      key: "source-lost",
      text:
        lost.health === "lost-permission"
          ? `${lost.label} ${REVOKED_LABEL}`
          : `${lost.label} lost`,
    };

  const inFlight = tasks.flatMap((task) =>
    task.current.runs.filter(isRunInFlight).map((run) => ({ task, run })),
  );
  const running = inFlight.filter(({ run }) => run.state === "running");
  const coding = running.find(({ run }) => run.actionKind === "solve-code");
  if (coding)
    return {
      key: "coding-draft",
      text: `Coding draft · task rev ${coding.task.currentRevision}`,
    };
  if (running.some(({ run }) => run.actionKind === "agent-solve"))
    return { key: "agent-working", text: "Agent job running" };
  const drafting = running.find(({ run }) => run.actionKind === "draft-answer");
  if (drafting)
    return drafting.task.kind === "programming-challenge"
      ? { key: "reading-coding-task", text: "Restating the coding task" }
      : { key: "drafting", text: "Drafting an answer" };

  // A ready result stands until a later line is heard.
  const ready = tasks
    .flatMap((task) => task.current.runs)
    .filter((run) => run.state === "published")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const heardSince =
    ready &&
    input.lastUtteranceAt !== null &&
    Date.parse(input.lastUtteranceAt) > Date.parse(ready.updatedAt);
  if (ready && !heardSince)
    return ready.actionKind === "solve-code"
      ? { key: "code-ready", text: "Code draft ready" }
      : { key: "answer-ready", text: "Answer ready" };

  if (companion.status === "never-seen")
    return { key: "companion-waiting", text: "Waiting for the companion" };
  if (companion.status === "offline")
    return { key: "companion-offline", text: "Companion offline" };
  return { key: "listening", text: "Listening" };
}

// ---- Locality ----------------------------------------------------------------

export type LocalityModel = {
  policy: LiveProcessingPolicy;
  label: string;
  tone: "green" | "amber";
  meaning: string;
  // After start the policy may only be tightened to device-only.
  canTighten: boolean;
};

export function localityModel(session: LiveSessionView): LocalityModel {
  const open = session.status !== "ended" && session.status !== "purging";
  return session.processingPolicy === "device-only"
    ? {
        policy: "device-only",
        label: "On this Mac only",
        tone: "green",
        meaning:
          "AI models run on this Mac only; nothing is sent to a remote model. Work that can't run here is refused, never sent elsewhere.",
        canTighten: false,
      }
    : {
        policy: "permitted-remote",
        label: "Remote allowed",
        tone: "amber",
        meaning:
          "Remote AI models may process this session's content. You can switch to on-device models only, but not back.",
        canTighten: open,
      };
}
