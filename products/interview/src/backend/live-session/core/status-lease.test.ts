import { describe, expect, it } from "vitest";
import {
  acceptsDispatch,
  acquireLease,
  canPublish,
  holderStanding,
  ingestRefusal,
  initialLease,
  renewLease,
  type SessionStatus,
  type StatusActor,
  type StatusCommand,
  tightenPolicy,
  transitionStatus,
} from "./index.js";

describe("stop authority (rule:owner-starts-and-resumes)", () => {
  const ACTORS: StatusActor[] = [
    "owner-control",
    "credential-expiry",
    "companion-stop",
    "duration-cap",
    "purge",
  ];

  it("lets only the owner's control start or resume capture", () => {
    for (const actor of ACTORS) {
      const start = transitionStatus("created", "start", actor);
      const resume = transitionStatus("paused", "resume", actor);
      expect(start.ok).toBe(actor === "owner-control");
      expect(resume.ok).toBe(actor === "owner-control");
      if (!start.ok) expect(start.reason).toBe("actor_not_permitted");
    }
  });

  it("makes credential expiry and companion stop PAUSE, never end", () => {
    for (const actor of ["credential-expiry", "companion-stop"] as const) {
      expect(transitionStatus("active", "pause", actor)).toEqual({
        ok: true,
        status: "paused",
        changed: true,
      });
      for (const from of ["active", "paused"] as const) {
        expect(transitionStatus(from, "end", actor)).toMatchObject({
          ok: false,
          reason: "actor_not_permitted",
        });
      }
    }
  });

  it("ends only on the owner's control or the duration cap", () => {
    for (const actor of ACTORS) {
      const ends = transitionStatus("active", "end", actor).ok;
      expect(ends).toBe(actor === "owner-control" || actor === "duration-cap");
    }
    expect(transitionStatus("paused", "end", "duration-cap")).toMatchObject({
      ok: true,
      status: "ended",
    });
  });

  it("does not let the duration cap or purge pause or resume", () => {
    expect(transitionStatus("active", "pause", "duration-cap").ok).toBe(false);
    expect(transitionStatus("active", "pause", "purge").ok).toBe(false);
  });

  it("lets the sweep purge only an ended session, but owner delete at any open status", () => {
    for (const from of ["created", "active", "paused"] as const) {
      expect(transitionStatus(from, "begin-purge", "purge")).toMatchObject({
        ok: false,
        reason: "invalid_transition",
      });
      expect(
        transitionStatus(from, "begin-purge", "owner-control"),
      ).toMatchObject({
        ok: true,
        status: "purging",
      });
    }
    expect(transitionStatus("ended", "begin-purge", "purge")).toMatchObject({
      ok: true,
      status: "purging",
    });
    expect(transitionStatus("active", "begin-purge", "companion-stop").ok).toBe(
      false,
    );
    expect(
      transitionStatus("purging", "complete-purge", "purge"),
    ).toMatchObject({
      ok: true,
      status: "ended",
    });
    expect(
      transitionStatus("purging", "complete-purge", "owner-control").ok,
    ).toBe(false);
  });

  it("rejects transitions from the wrong state and keeps repeats idempotent", () => {
    expect(transitionStatus("created", "pause", "owner-control")).toMatchObject(
      {
        ok: false,
        reason: "invalid_transition",
      },
    );
    expect(transitionStatus("ended", "resume", "owner-control").ok).toBe(false);
    expect(transitionStatus("purging", "resume", "owner-control").ok).toBe(
      false,
    );
    expect(transitionStatus("active", "start", "owner-control").ok).toBe(false);
    expect(transitionStatus("paused", "pause", "companion-stop")).toEqual({
      ok: true,
      status: "paused",
      changed: false,
    });
    expect(transitionStatus("ended", "end", "owner-control")).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(transitionStatus("purging", "begin-purge", "purge")).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it("checks authority before state", () => {
    expect(transitionStatus("ended", "start", "companion-stop")).toMatchObject({
      reason: "actor_not_permitted",
    });
  });

  it("refuses ingest and dispatch unless active; purging and ended refuse both", () => {
    const all: SessionStatus[] = [
      "created",
      "active",
      "paused",
      "purging",
      "ended",
    ];
    for (const status of all) {
      expect(ingestRefusal(status) === null).toBe(status === "active");
      expect(acceptsDispatch(status)).toBe(status === "active");
    }
    expect(ingestRefusal("purging")).toBe("session_purging");
    expect(ingestRefusal("ended")).toBe("session_ended");
  });

  it("covers every command in the matrix without throwing", () => {
    const commands: StatusCommand[] = [
      "start",
      "resume",
      "pause",
      "end",
      "begin-purge",
      "complete-purge",
    ];
    const statuses: SessionStatus[] = [
      "created",
      "active",
      "paused",
      "purging",
      "ended",
    ];
    for (const c of commands)
      for (const s of statuses)
        for (const a of ACTORS) {
          expect(typeof transitionStatus(s, c, a).ok).toBe("boolean");
        }
  });
});

describe("tighten-only locality (rule:tighten-only-locality)", () => {
  it("allows tightening and no-ops, refuses loosening", () => {
    expect(tightenPolicy("permitted-remote", "device-only")).toEqual({
      ok: true,
      policy: "device-only",
    });
    expect(tightenPolicy("device-only", "device-only")).toEqual({
      ok: true,
      policy: "device-only",
    });
    expect(tightenPolicy("permitted-remote", "permitted-remote")).toEqual({
      ok: true,
      policy: "permitted-remote",
    });
    expect(tightenPolicy("device-only", "permitted-remote")).toEqual({
      ok: false,
      reason: "loosening_refused",
    });
  });
});

describe("lease and fence (rule:fenced-current-publish)", () => {
  it("increments the fence on every acquire, including the same holder", () => {
    const first = acquireLease(initialLease(), "w1", 1000, 500);
    expect(first).toMatchObject({ acquired: true, fence: 1 });
    if (!first.acquired) return;
    const again = acquireLease(first.lease, "w1", 1100, 500);
    expect(again).toMatchObject({ acquired: true, fence: 2 });
  });

  it("refuses a live lease held by another and takes over an expired one", () => {
    const first = acquireLease(initialLease(), "w1", 1000, 500);
    if (!first.acquired) throw new Error("expected acquired");
    expect(acquireLease(first.lease, "w2", 1200, 500)).toEqual({
      acquired: false,
      reason: "held_by_other",
      fence: 1,
    });
    const takeover = acquireLease(first.lease, "w2", 1500, 500);
    expect(takeover).toMatchObject({ acquired: true, fence: 2 });
  });

  it("renew keeps the fence and extends expiry", () => {
    const first = acquireLease(initialLease(), "w1", 1000, 500);
    if (!first.acquired) throw new Error("expected acquired");
    const renewed = renewLease(first.lease, "w1", 1, 1200, 500);
    expect(renewed).toEqual({
      renewed: true,
      lease: { fence: 1, holderId: "w1", expiresAtMs: 1700 },
    });
  });

  it("refuses renewal by a superseded, foreign or expired holder", () => {
    const first = acquireLease(initialLease(), "w1", 1000, 500);
    if (!first.acquired) throw new Error("expected acquired");
    const second = acquireLease(first.lease, "w2", 1600, 500);
    if (!second.acquired) throw new Error("expected acquired");
    expect(renewLease(second.lease, "w1", 1, 1700, 500)).toEqual({
      renewed: false,
      reason: "fence_superseded",
    });
    expect(renewLease(second.lease, "w1", 2, 1700, 500)).toEqual({
      renewed: false,
      reason: "not_holder",
    });
    expect(renewLease(second.lease, "w2", 2, 2100, 500)).toEqual({
      renewed: false,
      reason: "expired",
    });
  });

  it("tells a holder that sees a newer fence to stop", () => {
    const first = acquireLease(initialLease(), "w1", 1000, 500);
    if (!first.acquired) throw new Error("expected acquired");
    expect(holderStanding(first.lease, "w1", 1, 1100)).toBe("holding");
    expect(holderStanding(first.lease, "w1", 1, 1500)).toBe("stop-expired");
    const second = acquireLease(first.lease, "w2", 1500, 500);
    if (!second.acquired) throw new Error("expected acquired");
    expect(holderStanding(second.lease, "w1", 1, 1600)).toBe("stop-superseded");
  });
});

describe("canPublish (rule:fenced-current-publish, rule:pause-end-suppression)", () => {
  const ok = {
    sessionStatus: "active" as const,
    leaseFence: 3,
    holderFence: 3,
    taskRevision: 2,
    currentTaskRevision: 2,
  };

  it("is eligible only when status, fence and revision are all current", () => {
    expect(canPublish(ok)).toEqual({ eligible: true });
  });

  it("refuses by session status", () => {
    expect(canPublish({ ...ok, sessionStatus: "paused" })).toEqual({
      eligible: false,
      reason: "session_paused",
    });
    expect(canPublish({ ...ok, sessionStatus: "ended" })).toEqual({
      eligible: false,
      reason: "session_ended",
    });
    expect(canPublish({ ...ok, sessionStatus: "purging" })).toEqual({
      eligible: false,
      reason: "session_purging",
    });
    expect(canPublish({ ...ok, sessionStatus: "created" })).toEqual({
      eligible: false,
      reason: "session_not_active",
    });
  });

  it("refuses a restarted worker's older fence", () => {
    expect(canPublish({ ...ok, holderFence: 2 })).toEqual({
      eligible: false,
      reason: "fence_superseded",
    });
  });

  it("refuses a stale revision and a superseded source", () => {
    expect(canPublish({ ...ok, taskRevision: 1 })).toEqual({
      eligible: false,
      reason: "revision_stale",
    });
    expect(canPublish({ ...ok, sourceSuperseded: true })).toEqual({
      eligible: false,
      reason: "source_superseded",
    });
  });

  it("reports status before fence before revision", () => {
    expect(
      canPublish({
        ...ok,
        sessionStatus: "paused",
        holderFence: 1,
        taskRevision: 1,
      }),
    ).toEqual({ eligible: false, reason: "session_paused" });
    expect(canPublish({ ...ok, holderFence: 1, taskRevision: 1 })).toEqual({
      eligible: false,
      reason: "fence_superseded",
    });
  });
});
