// The view model every Live session screen reads: a PURE derivation from the
// session record, the observations and actions the store holds, and a point in
// time. No fetching, no timers, no React: the same inputs give the same model,
// which is what the derivation tests rely on.
import type {
  LiveAction,
  LiveObservation,
  LiveSessionStatus,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import {
  type Activity,
  type Banner,
  type CapModel,
  capModel,
  deriveActivity,
  deriveBanners,
  type LocalityModel,
  localityModel,
} from "./session-banners";
import { elapsedMs, formatElapsed } from "./session-merge";
import type { SessionErrorCode } from "./session-client";
import type { ActivityRun } from "./session-runs";
import {
  type CompanionModel,
  companionModel,
  type SourceStatus,
  sourceStatuses,
} from "./session-sources";
import { deriveTasks, type TaskView } from "./session-tasks";
import { type TranscriptRow, transcriptRows } from "./session-transcript";

// The bar's dot and label.
//   live         active and nothing wrong with capture
//   paused       the owner (or a credential problem) paused it
//   source-lost  a source is disconnected, lost or its permission was revoked
//   waiting      created, the companion has not made contact yet
//   ended        finished (or being deleted)
//   unreachable  Studio's session service cannot be read, so what is shown
//                may be out of date
export type BarState =
  | "live"
  | "paused"
  | "source-lost"
  | "waiting"
  | "ended"
  | "unreachable";

// No successful read of the stream for this long (the store polls every second
// while active) means what is on screen may be out of date.
export const STREAM_STALE_AFTER_MS = 20_000;

export type LiveStats = {
  utterances: number;
  screenshots: number;
  gaps: number;
  tasks: number;
  // Answer drafts and coding drafts that were published.
  answersPublished: number;
  codeDraftsPublished: number;
  // Drafts shown while a (non-strict) rehearsal counted them as hints.
  hintsCounted: number;
};

export type LiveViewModel = {
  // none: no session. open: created, active or paused. finished: ended or
  // being deleted.
  phase: "none" | "open" | "finished";
  status: LiveSessionStatus | null;
  barState: BarState;
  barLabel: string;
  // The stream cannot be read (an error, or no read for a while): the model
  // then draws no conclusion that needs a fresh read, such as a silent
  // companion, and the elapsed clock stands still.
  streamStale: boolean;
  // The server's time as the browser knows it (ms since the epoch).
  serverNowMs: number;
  elapsedMs: number;
  elapsedLabel: string;
  sources: SourceStatus[];
  companion: CompanionModel;
  banners: Banner[];
  activity: Activity;
  tasks: TaskView[];
  runs: ActivityRun[];
  transcript: TranscriptRow[];
  locality: LocalityModel | null;
  cap: CapModel | null;
  stats: LiveStats;
};

export type LiveModelInput = {
  session: LiveSessionView | null;
  observations: readonly LiveObservation[];
  actions: readonly LiveAction[];
  serverClockOffsetMs: number;
  // The browser clock; the model reads server time as now + offset.
  nowMs: number;
  // The store's last successful read (browser clock) and its last failure.
  lastReadAt?: number | null;
  streamError?: SessionErrorCode | null;
};

const EMPTY_STATS: LiveStats = {
  utterances: 0,
  screenshots: 0,
  gaps: 0,
  tasks: 0,
  answersPublished: 0,
  codeDraftsPublished: 0,
  hintsCounted: 0,
};

function barOf(
  session: LiveSessionView,
  sources: readonly SourceStatus[],
  streamStale: boolean,
): { state: BarState; label: string } {
  if (session.status === "ended" || session.status === "purging")
    return { state: "ended", label: "Ended" };
  if (streamStale) return { state: "unreachable", label: "Can't reach Studio" };
  if (session.status === "paused") return { state: "paused", label: "Paused" };
  if (sources.some((source) => source.lost))
    return { state: "source-lost", label: "Source lost" };
  if (session.status === "created")
    return { state: "waiting", label: "Waiting for the companion" };
  return { state: "live", label: "Live" };
}

export function deriveLiveModel(input: LiveModelInput): LiveViewModel {
  const { session, observations, actions } = input;
  const serverNowMs = input.nowMs + input.serverClockOffsetMs;
  if (!session)
    return {
      phase: "none",
      status: null,
      barState: "ended",
      barLabel: "",
      streamStale: false,
      serverNowMs,
      elapsedMs: 0,
      elapsedLabel: "0:00",
      sources: [],
      companion: {
        status: "never-seen",
        lastContactAt: null,
        ageMs: null,
        credential: "none",
        credentialExpiresInMs: null,
      },
      banners: [],
      activity: { key: "ended", text: "" },
      tasks: [],
      runs: [],
      transcript: [],
      locality: null,
      cap: null,
      stats: EMPTY_STATS,
    };

  const lastReadAt = input.lastReadAt ?? null;
  const streamStale =
    input.streamError != null ||
    (lastReadAt !== null && input.nowMs - lastReadAt > STREAM_STALE_AFTER_MS);
  // [SAFETY] Offline is only meaningful with a fresh read: while the stream
  // cannot be read, contact age is judged at the last read, not at now.
  const readNowMs =
    streamStale && lastReadAt !== null
      ? lastReadAt + input.serverClockOffsetMs
      : serverNowMs;
  const companion = companionModel(session, serverNowMs, readNowMs);
  const sources = sourceStatuses(
    session,
    observations,
    companion.status === "online",
  );
  const tasks = deriveTasks(actions, session.status);
  const transcript = transcriptRows(observations, tasks);
  const cap = capModel(session, serverNowMs);
  const bar = barOf(session, sources, streamStale);
  const lastUtterance = [...observations]
    .reverse()
    .find((observation) => observation.kind === "transcript.final");
  const runs = tasks
    .flatMap((task) => task.revisions.flatMap((revision) => revision.runs))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const elapsed = elapsedMs(
    session,
    input.serverClockOffsetMs,
    streamStale && lastReadAt !== null ? lastReadAt : input.nowMs,
  );
  const published = (kind: string) =>
    runs.filter((run) => run.actionKind === kind && run.state === "published")
      .length;

  return {
    phase:
      session.status === "ended" || session.status === "purging"
        ? "finished"
        : "open",
    status: session.status,
    barState: bar.state,
    barLabel: bar.label,
    streamStale,
    serverNowMs,
    elapsedMs: elapsed,
    elapsedLabel: formatElapsed(elapsed),
    sources,
    companion,
    banners: deriveBanners(session, sources, companion, cap, streamStale),
    activity: deriveActivity({
      streamStale,
      session,
      sources,
      companion,
      tasks,
      lastUtteranceAt: lastUtterance?.receivedAt ?? null,
    }),
    tasks,
    runs,
    transcript,
    locality: localityModel(session),
    cap,
    stats: {
      utterances: transcript.filter((row) => row.type === "utterance").length,
      screenshots: transcript.filter((row) => row.type === "screenshot").length,
      gaps: transcript.filter((row) => row.type === "gap").length,
      tasks: tasks.length,
      answersPublished: published("draft-answer"),
      codeDraftsPublished: published("solve-code"),
      hintsCounted: session.shownDraftCount,
    },
  };
}
