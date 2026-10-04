// TEST SUPPORT, not for production hosts (exported only through the
// `session-testing` entry): an in-memory session world for the processor's
// ports, with the same fenced rules as the database writes (holder fence and
// lease, status and revision eligibility through the neutral core, dispatch
// dedup, suppression on a stale publish). It lets a host's test drive the REAL
// processor, REAL gateway and REAL agent port end to end without a database.
//
// Its fenced rules are the neutral core's OWN functions (canPublish,
// decideDispatch, holderStanding, revisionStanding), imported below, never a
// copy of them; memory-session-world.test.ts pins that, so a host's end-to-end
// result means what the database path means.
//
// What it does not do: the Workspace draft write of a coding publish (a
// database effect, covered by the database suites) and row security.
import { randomUUID } from "node:crypto";
import { OWNER_INPUT_SOURCE_ID } from "../db/live-session.js";
import { buildContextSnapshot } from "./context-snapshot.js";
import {
  canPublish,
  decideDispatch,
  dispatchKey,
  holderStanding,
  revisionStanding,
  sourceIdsOf,
} from "./core/index.js";
import type { Refused, WriteRefusalReason } from "./fenced-writes.js";
import type { SessionClaimPort, SessionStorePort } from "./processor-ports.js";
import type { SessionClaim, SessionTarget } from "./session-claim.js";
import type { StoredAction, StoredObservation } from "./session-reads.js";
import type { SessionView } from "./session-record.js";

export type MemoryWorldOptions = {
  processingPolicy?: "device-only" | "permitted-remote";
  liveAssistance?: boolean;
};

type MemoryState = {
  status: "active" | "paused" | "ended" | "purging";
  policy: "device-only" | "permitted-remote";
  liveAssistance: boolean;
  fence: number;
  holderId: string | null;
  processedThrough: number;
  purged: boolean;
};

export type MemorySessionWorld = ReturnType<typeof createMemorySessionWorld>;

export function createMemorySessionWorld(options: MemoryWorldOptions = {}) {
  const tenantId = randomUUID();
  const ownerUserId = randomUUID();
  const sessionId = randomUUID();
  const scope = { tenantId, actorId: ownerUserId };
  const state: MemoryState = {
    status: "active",
    policy: options.processingPolicy ?? "permitted-remote",
    liveAssistance: options.liveAssistance ?? true,
    fence: 0,
    holderId: null,
    processedThrough: 0,
    purged: false,
  };
  const observations: StoredObservation[] = [];
  let actions: StoredAction[] = [];
  const events = { purges: 0 };
  let tick = 0;
  const stamp = () => new Date(1_790_000_000_000 + (tick += 1)).toISOString();

  const nextSequence = () =>
    observations.reduce((max, o) => Math.max(max, o.sequence), 0) + 1;

  const push = (
    sourceId: string,
    eventId: string,
    kind: string,
    body: unknown,
    screenshotArtifactId: string | null = null,
  ): StoredObservation => {
    const stored: StoredObservation = {
      sequence: nextSequence(),
      sourceId,
      eventId,
      kind,
      receivedAt: stamp(),
      content: {
        occurredAt: "2026-10-03T10:00:00.000Z",
        sourceSequence: 0,
        body,
      },
      screenshotArtifactId,
    };
    observations.push(stored);
    return stored;
  };

  const target = (): SessionTarget => ({ tenantId, ownerUserId, sessionId });

  const refuse = (reason: WriteRefusalReason, recorded = false): Refused => ({
    outcome: "refused",
    reason,
    suppressionRecorded: recorded,
  });
  // The fenced-write guard: only the holder at the current fence writes.
  const guard = (holder: {
    workerId: string;
    fence: number;
  }): Refused | null => {
    if (state.purged) return refuse("session_not_found");
    const standing = holderStanding(
      {
        fence: state.fence,
        holderId: state.holderId,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
      },
      holder.workerId,
      holder.fence,
      Date.now(),
    );
    if (standing === "stop-superseded") return refuse("fence_superseded");
    if (standing === "stop-expired") return refuse("lease_expired");
    if (state.status === "purging") return refuse("session_purging");
    return null;
  };
  const find = (id: string) => actions.find((action) => action.id === id);
  const touch = (action: StoredAction, patch: Partial<StoredAction>) => {
    Object.assign(action, patch, { updatedAt: stamp() });
  };

  const view = (): SessionView =>
    ({
      id: sessionId,
      status: state.status,
      processingPolicy: state.policy,
      liveAssistance: state.liveAssistance,
      purged: state.purged,
    }) as unknown as SessionView;

  const store: SessionStorePort = {
    async recordAction(input) {
      const blocked = guard(input.holder);
      if (blocked) return blocked;
      const request = {
        sessionId,
        taskId: input.taskId,
        revision: input.revision,
        actionKind: input.actionKind,
      };
      const rows = actions.filter(
        (a) =>
          a.taskId === input.taskId &&
          a.taskRevision === input.revision &&
          a.actionKind === input.actionKind,
      );
      const attempts = rows.reduce((max, r) => Math.max(max, r.attempt), 0);
      const status = rows.some((r) => r.dispatchStatus === "succeeded")
        ? "succeeded"
        : rows.some((r) => r.dispatchStatus === "in_flight")
          ? "in-flight"
          : rows.some((r) => r.dispatchStatus === "failed")
            ? "failed"
            : null;
      const key = dispatchKey(request);
      const decision = decideDispatch(
        status === null
          ? { entries: {} }
          : { entries: { [key]: { key, status, attempts } } },
        input.tasks,
        state.status,
        request,
      );
      const sources = sourceIdsOf(input.tasks, input.taskId, input.revision);
      const row = (patch: Partial<StoredAction>): StoredAction => ({
        id: randomUUID(),
        taskId: input.taskId,
        taskRevision: input.revision,
        actionKind: input.actionKind,
        dispatchStatus: "in_flight",
        attempt: 1,
        fenceAtDispatch: state.fence,
        jobId: null,
        jobCreated: false,
        sourceEventIds: sources,
        result: null,
        shown: false,
        suppressionReason: null,
        createdAt: stamp(),
        updatedAt: stamp(),
        ...patch,
      });
      if (decision.decision === "duplicate")
        return { outcome: "duplicate", existing: decision.existing };
      if (decision.decision === "suppressed") {
        actions.push(
          row({
            dispatchStatus: "suppressed",
            suppressionReason: decision.suppression.reason,
          }),
        );
        return { outcome: "suppressed", reason: decision.suppression.reason };
      }
      const created = row({ attempt: decision.attempt });
      actions.push(created);
      return {
        outcome: "dispatched",
        actionId: created.id,
        attempt: decision.attempt,
        jobId: null,
      };
    },
    async readDispatchStanding(input) {
      const blocked = guard(input.holder);
      if (blocked) return blocked;
      return {
        outcome: "standing",
        status: state.status,
        processingPolicy: state.policy,
        liveAssistance: state.liveAssistance,
        fence: state.fence,
      };
    },
    async publishResult(input) {
      const blocked = guard(input.holder);
      if (blocked) return blocked;
      const action = find(input.actionId);
      if (!action) return refuse("action_not_found");
      if (action.dispatchStatus !== "in_flight")
        return refuse("action_settled");
      const task = input.tasks.tasks[action.taskId];
      const eligibility = task
        ? canPublish({
            sessionStatus: state.status,
            leaseFence: state.fence,
            holderFence: input.holder.fence,
            taskRevision: action.taskRevision,
            currentTaskRevision: task.revision,
            sourceSuperseded:
              revisionStanding(
                input.tasks,
                action.taskId,
                action.taskRevision,
              ) === "source_superseded",
          })
        : { eligible: false as const, reason: "revision_stale" as const };
      if (!eligibility.eligible) {
        touch(action, {
          dispatchStatus: "suppressed",
          suppressionReason: eligibility.reason,
        });
        return refuse(eligibility.reason, true);
      }
      touch(action, {
        dispatchStatus: "succeeded",
        result: input.result,
        shown: input.show === true,
      });
      return { outcome: "published" };
    },
    async recordFailure(input) {
      const blocked = guard(input.holder);
      if (blocked) return blocked;
      const action = find(input.actionId);
      if (!action || action.dispatchStatus !== "in_flight")
        return refuse("action_settled");
      touch(action, { dispatchStatus: "failed" });
      return { outcome: "recorded" };
    },
    async abandonAction(input) {
      const blocked = guard(input.holder);
      if (blocked) return blocked;
      const action = find(input.actionId);
      if (!action || action.dispatchStatus !== "in_flight")
        return refuse("action_settled");
      touch(action, {
        dispatchStatus: "suppressed",
        suppressionReason: input.reason,
      });
      return { outcome: "recorded" };
    },
    async recordProcessedThrough(input) {
      const blocked = guard(input.holder);
      if (blocked) return blocked;
      state.processedThrough = Math.max(state.processedThrough, input.through);
      return { outcome: "recorded" };
    },
    async reconcile() {
      return view();
    },
    async observationsAfter(_scope, _session, afterSequence, limit) {
      return observations
        .filter((o) => o.sequence > afterSequence)
        .slice(0, limit);
    },
    async actions() {
      return [...actions].reverse();
    },
    async processedThrough() {
      return state.processedThrough;
    },
    async loadContext() {
      return {
        matrix: null,
        snapshot: buildContextSnapshot({ matrix: null, profile: null }),
      };
    },
    async cancelJobs() {
      return undefined;
    },
    async createJob() {
      return undefined;
    },
    async purge() {
      events.purges += 1;
      const counts = {
        observations: observations.length,
        screenshotArtifacts: 0,
        actions: actions.length,
        jobs: 0,
        jobEvents: 0,
        jobArtifacts: 0,
        jobPayloads: 0,
        agentSessions: 0,
        drafts: 0,
      };
      observations.length = 0;
      actions = [];
      state.purged = true;
      state.status = "ended";
      return { outcome: "complete", counts };
    },
  };

  const claimFor = (workerId: string): SessionClaimPort => ({
    async claim(_limit, { includeOwnLive }) {
      if (state.status !== "active") return [];
      const free = state.holderId === null;
      const own = state.holderId === workerId && includeOwnLive;
      if (!free && !own) return [];
      state.fence += 1;
      state.holderId = workerId;
      return [{ ...target(), fence: state.fence }];
    },
    async renew(claim: SessionClaim) {
      return claim.fence === state.fence && state.holderId === workerId
        ? { renewed: true }
        : { renewed: false, reason: "fence_superseded" };
    },
    async release(claim: SessionClaim) {
      if (claim.fence !== state.fence) return false;
      state.holderId = null;
      return true;
    },
    async purgeCandidates() {
      return (state.status === "ended" || state.status === "purging") &&
        !state.purged
        ? [target()]
        : [];
    },
    async capExpired() {
      return [];
    },
  });

  return {
    scope,
    sessionId,
    state,
    observations,
    get actions() {
      return actions;
    },
    purges: events,
    store,
    claimFor,
    // The companion's captures and the owner's own inputs, as stored rows.
    transcript(input: {
      eventId: string;
      text: string;
      speaker?: string;
      supersedes?: string;
      startMs?: number;
      source?: "microphone" | "application-audio";
    }) {
      const startMs = input.startMs ?? observations.length * 10_000;
      return push(
        input.source === "microphone" ? "mic" : "app",
        input.eventId,
        "transcript.final",
        {
          speaker: input.speaker ?? "interviewer",
          source: input.source ?? "application-audio",
          text: input.text,
          startMs,
          endMs: startMs + 5_000,
          ...(input.supersedes ? { supersedes: input.supersedes } : {}),
        },
      );
    },
    snapshot(input: {
      eventId: string;
      mediaType?: string;
      sourceId?: string;
    }) {
      return push(
        input.sourceId ?? "screen",
        input.eventId,
        "screen.snapshot",
        {
          payloadRef: `shot-${input.eventId}`,
          mediaType: input.mediaType ?? "image/png",
          byteLength: 100,
          windowLabel: "Window",
        },
        randomUUID(),
      );
    },
    ownerInput(requestId: string, body: Record<string, unknown>) {
      return push(OWNER_INPUT_SOURCE_ID, requestId, "owner.input", body);
    },
    status(next: MemoryState["status"]) {
      state.status = next;
    },
    tighten() {
      state.policy = "device-only";
    },
  };
}
