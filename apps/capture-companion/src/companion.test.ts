import type { CaptureRequest } from "@omnitech/active-session-contracts";
import { describe, expect, it } from "vitest";
import { CompanionError } from "./errors";
import {
  acceptedAck,
  FAKE_CREDENTIAL,
  fakeStudio,
  type RecordedRequest,
  refusedAck,
} from "./fixture/fake-studio";
import { speechUnavailableDevice } from "./fixture/fakes";
import {
  createFixtureCompanion,
  type FixtureCompanionOptions,
} from "./fixture/index";
import { VirtualClock } from "./fixture/virtual-clock";

const MARKER = "SYNTHETIC-TRANSCRIPT-MARKER";

function setup(options: Partial<FixtureCompanionOptions> = {}) {
  const clock = new VirtualClock();
  const studio = fakeStudio();
  const fixture = createFixtureCompanion({
    baseUrl: "https://studio.example.test",
    tenantSlug: "acme",
    credential: FAKE_CREDENTIAL,
    fetch: studio.fetch,
    clock,
    ...options,
  });
  const say = (
    eventId: string,
    source: "microphone" | "application-audio" = "microphone",
  ) =>
    fixture.companion.observeTranscript({
      eventId,
      source,
      text: `${MARKER} ${eventId}`,
      startMs: 0,
      endMs: 1500,
    });
  return { clock, studio, say, ...fixture };
}

const kinds = (requests: RecordedRequest[]) =>
  requests.map((request) => request.message.kind);
const transcripts = (requests: RecordedRequest[]) =>
  requests.filter((request) => request.message.kind === "transcript.final");

describe("startup", () => {
  it("sends the capability report before anything else, then starts listening", async () => {
    const { companion, studio, capture } = setup();
    await companion.start();
    expect(kinds(studio.requests)).toEqual(["capability.report", "heartbeat"]);
    expect(studio.requests[0]?.message).toMatchObject({
      speech: { onDeviceAvailable: true },
    });
    expect(studio.requests[1]?.message).toMatchObject({ capturing: true });
    expect(capture.active()).toEqual(["microphone", "application-audio"]);
    expect(companion.snapshot().phase).toBe("listening");
    expect(companion.snapshot().connected).toBe(true);
    // Starting twice does nothing more.
    await companion.start();
    expect(studio.requests).toHaveLength(2);
  });

  it("holds every transcript until the capability report is acknowledged", async () => {
    const { companion, studio, say, clock } = setup();
    studio.down = true;
    await companion.start();
    await say("e1");
    expect(
      kinds(studio.requests).every((kind) => kind !== "transcript.final"),
    ).toBe(true);
    studio.down = false;
    await clock.advance(5000);
    await companion.flush();
    expect(kinds(studio.requests).slice(-2)).toEqual([
      "capability.report",
      "transcript.final",
    ]);
    expect(companion.pending).toBe(0);
  });
});

describe("outbox behaviour through the loop", () => {
  it("resends the SAME ids after a dropped connection", async () => {
    const { companion, studio, say, clock } = setup();
    await companion.start();
    studio.down = true;
    await say("e1");
    await say("e2");
    studio.down = false;
    await clock.advance(5000);
    await companion.flush();
    const sent = transcripts(studio.requests).map((request) => [
      request.message.eventId,
      request.message.sequence,
    ]);
    // e1 was tried while down, then retried; e2 followed in order.
    expect(sent).toEqual([
      ["e1", 0],
      ["e1", 0],
      ["e2", 1],
    ]);
    expect(companion.pending).toBe(0);
  });

  it("does not retry before the backoff hold has passed", async () => {
    const { companion, studio, say, clock } = setup();
    await companion.start();
    studio.down = true;
    await say("e1");
    const attempts = studio.requests.length;
    await companion.flush();
    expect(studio.requests).toHaveLength(attempts);
    studio.down = false;
    await clock.advance(5000);
    await companion.flush();
    expect(studio.requests.length).toBeGreaterThan(attempts);
  });

  it("removes a message on a duplicate acknowledgement", async () => {
    const { companion, studio, say } = setup();
    await companion.start();
    studio.script = (request) =>
      request.message.kind === "transcript.final"
        ? {
            version: 1,
            status: "duplicate",
            original: acceptedAck(request.message) as never,
          }
        : undefined;
    await say("e1");
    expect(companion.pending).toBe(0);
    await companion.flush();
    expect(transcripts(studio.requests)).toHaveLength(1);
  });

  it("honours Retry-After on rate_limited and then resends the same ids", async () => {
    const { companion, studio, say, clock } = setup();
    await companion.start();
    let limited = true;
    studio.script = (request) => {
      if (request.message.kind !== "transcript.final" || !limited) return;
      limited = false;
      return { ack: refusedAck("rate_limited", "active"), retryAfter: "3" };
    };
    await say("e1");
    expect(companion.pending).toBe(1);
    await clock.advance(2000);
    await companion.flush();
    expect(transcripts(studio.requests)).toHaveLength(1);
    await clock.advance(1500);
    await companion.flush();
    expect(
      transcripts(studio.requests).map((request) => request.message.eventId),
    ).toEqual(["e1", "e1"]);
    expect(companion.pending).toBe(0);
  });

  it("falls back to backoff when rate_limited has no Retry-After", async () => {
    const { companion, studio, say, clock } = setup();
    await companion.start();
    let limited = true;
    studio.script = (request) => {
      if (request.message.kind !== "transcript.final" || !limited) return;
      limited = false;
      return refusedAck("rate_limited");
    };
    await say("e1");
    await clock.advance(5000);
    await companion.flush();
    expect(companion.pending).toBe(0);
  });

  it("records overflow as a capture.gap that reaches Studio once it is back", async () => {
    const { companion, studio, say, clock } = setup({ outboxCapacity: 2 });
    await companion.start();
    studio.down = true;
    for (const id of ["e1", "e2", "e3", "e4"]) await say(id);
    expect(companion.pending).toBe(3);
    studio.down = false;
    await clock.advance(60_000);
    await companion.flush();
    const gaps = studio.requests.filter(
      (request) => request.message.kind === "capture.gap",
    );
    expect(gaps.at(-1)?.message).toMatchObject({
      content: { source: "microphone", reason: "buffer-overflow" },
    });
    expect(companion.pending).toBe(0);
  });

  it("drops and surfaces permanent refusals without retrying", async () => {
    const { companion, studio, say } = setup();
    await companion.start();
    studio.script = (request) =>
      request.message.kind === "transcript.final"
        ? refusedAck("event_conflict", "active")
        : undefined;
    await say("e1");
    expect(companion.pending).toBe(0);
    expect(companion.snapshot().notices).toEqual([
      { code: "event_conflict", source: "microphone" },
    ]);
    expect(transcripts(studio.requests)).toHaveLength(1);
  });

  it("serialises concurrent observations in order", async () => {
    const { companion, studio, say } = setup();
    await companion.start();
    await Promise.all([say("e1"), say("e2"), say("e3")]);
    expect(
      transcripts(studio.requests).map((request) => request.message.eventId),
    ).toEqual(["e1", "e2", "e3"]);
  });
});

describe("control pull", () => {
  it("pause stops capture and drops buffers; resume restarts and records the gap", async () => {
    const { companion, studio, capture, say, clock } = setup();
    await companion.start();
    studio.down = true;
    await say("e1");
    expect(companion.pending).toBe(1);
    studio.down = false;
    studio.state = "paused";
    await clock.advance(5000);
    await companion.heartbeat();
    expect(companion.snapshot().phase).toBe("paused");
    expect(capture.active()).toEqual([]);
    expect(companion.pending).toBe(0);
    // Nothing captured while paused is accepted.
    const before = studio.requests.length;
    await say("while-paused");
    expect(studio.requests).toHaveLength(before);
    // Paused by Studio, the companion still says capturing:true: Studio
    // pauses a session on capturing:false, so reporting it here would undo the
    // owner's next resume.
    await clock.advance(5000);
    await companion.heartbeat();
    expect(studio.requests.at(-1)?.message).toMatchObject({
      kind: "heartbeat",
      capturing: true,
    });
    studio.state = "active";
    await clock.advance(5000);
    await companion.heartbeat();
    expect(companion.snapshot().phase).toBe("listening");
    expect(capture.active()).toEqual(["microphone", "application-audio"]);
    await companion.flush();
    const gaps = studio.requests.filter(
      (request) => request.message.kind === "capture.gap",
    );
    expect(gaps).toHaveLength(2);
    expect(gaps[0]?.message).toMatchObject({
      content: { reason: "paused", durationMs: 10_000 },
    });
  });

  it("an owner resume survives the companion's next heartbeat (Studio pauses on capturing:false)", async () => {
    const { companion, studio, clock } = setup();
    await companion.start();
    // Studio's real rule: a heartbeat saying capturing:false pauses an active
    // session and refuses with session_paused.
    studio.script = (request) => {
      const message = request.message;
      if (
        message.kind === "heartbeat" &&
        message.capturing === false &&
        studio.state === "active"
      ) {
        studio.state = "paused";
        return refusedAck("session_paused", "paused");
      }
      return undefined;
    };
    studio.state = "paused";
    await clock.advance(5000);
    await companion.heartbeat();
    studio.state = "active";
    for (let i = 0; i < 3; i++) {
      await clock.advance(5000);
      await companion.heartbeat();
    }
    expect(studio.state).toBe("active");
    expect(companion.snapshot().phase).toBe("listening");
  });

  it("resume restarts only locally selected sources, never ones Studio refused", async () => {
    const { companion, studio, capture, say, clock } = setup();
    await companion.start();
    studio.script = (request) =>
      request.message.kind === "transcript.final" &&
      request.message.sourceId === "application-audio"
        ? refusedAck("invalid_observation", "active")
        : undefined;
    await say("a1", "application-audio");
    expect(capture.active()).toEqual(["microphone"]);
    expect(companion.snapshot().sources["application-audio"]).toBe("refused");
    expect(companion.snapshot().notices).toContainEqual({
      code: "invalid_observation",
      source: "application-audio",
    });
    // A refused source's later observations are ignored.
    const before = transcripts(studio.requests).length;
    await say("a2", "application-audio");
    expect(transcripts(studio.requests)).toHaveLength(before);
    studio.script = undefined;
    studio.state = "paused";
    await clock.advance(5000);
    await companion.heartbeat();
    studio.state = "active";
    await clock.advance(5000);
    await companion.heartbeat();
    expect(capture.active()).toEqual(["microphone"]);
    expect(capture.active()).not.toContain("screen");
  });

  it("applies the state carried by refusals", async () => {
    const paused = setup();
    await paused.companion.start();
    paused.studio.script = (request) =>
      request.message.kind === "transcript.final"
        ? refusedAck("session_paused")
        : undefined;
    await paused.say("e1");
    expect(paused.companion.snapshot().phase).toBe("paused");

    const purging = setup();
    await purging.companion.start();
    purging.studio.script = () => refusedAck("session_purging", "purging");
    await purging.say("e1");
    expect(purging.companion.snapshot().phase).toBe("ended");
    expect(purging.capture.active()).toEqual([]);
  });

  it("ended stops capture for good and ends the loop", async () => {
    const { companion, studio, capture, clock } = setup();
    let beats = 0;
    studio.script = (request) => {
      if (request.message.kind === "heartbeat") beats += 1;
      return beats >= 3 ? acceptedAck(request.message, "ended") : undefined;
    };
    await clock.drive(companion.run());
    expect(companion.snapshot().phase).toBe("ended");
    expect(capture.active()).toEqual([]);
    // Heartbeats at t=0, 5 s and 10 s: the loop paces by the interval.
    expect(clock.elapsedMs).toBe(10_000);
    const sent = studio.requests.length;
    await companion.tick();
    await companion.heartbeat();
    expect(studio.requests).toHaveLength(sent);
  });

  it("never heartbeats faster than Studio's minimum spacing", async () => {
    const { companion, studio, clock } = setup({ heartbeatIntervalMs: 10 });
    let beats = 0;
    studio.script = (request) => {
      if (request.message.kind === "heartbeat") beats += 1;
      return beats >= 3 ? acceptedAck(request.message, "ended") : undefined;
    };
    await clock.drive(companion.run());
    expect(clock.elapsedMs).toBe(2000);
  });

  it("retries an undelivered message sooner than the heartbeat interval", async () => {
    const { companion, studio, say, clock } = setup();
    studio.down = true;
    await companion.start();
    await say("e1");
    studio.down = false;
    let deliveredAt = Number.NaN;
    studio.script = (request) => {
      if (request.message.kind === "transcript.final") {
        deliveredAt = clock.elapsedMs;
      }
      return request.message.kind === "heartbeat" &&
        transcripts(studio.requests).length >= 1
        ? acceptedAck(request.message, "ended")
        : undefined;
    };
    await clock.drive(companion.run());
    expect(
      transcripts(studio.requests).map((request) => request.message.eventId),
    ).toEqual(["e1"]);
    // Delivered after the short backoff hold (750 ms with the fixed jitter),
    // not after a whole 5 s heartbeat interval.
    expect(deliveredAt).toBe(750);
    expect(companion.snapshot().phase).toBe("ended");
  });

  it("a refused credential stops capture visibly and keeps nothing", async () => {
    const { companion, studio, capture, say, clock } = setup();
    await companion.start();
    studio.down = true;
    await say("e1");
    studio.down = false;
    studio.script = () => refusedAck("credential_refused");
    await clock.advance(5000);
    await companion.heartbeat();
    expect(companion.snapshot().phase).toBe("credential-refused");
    expect(capture.active()).toEqual([]);
    expect(companion.pending).toBe(0);
  });

  it("a held heartbeat waits out Retry-After", async () => {
    const { companion, studio, clock } = setup();
    await companion.start();
    studio.script = () => ({
      ack: refusedAck("rate_limited", "active"),
      retryAfter: "10",
    });
    await clock.advance(5000);
    await companion.heartbeat();
    const sent = studio.requests.length;
    await clock.advance(5000);
    await companion.heartbeat();
    expect(studio.requests).toHaveLength(sent);
  });

  it("surfaces other permanent refusal codes without changing state", async () => {
    const { companion, studio, say } = setup();
    await companion.start();
    studio.script = (request) =>
      request.message.kind === "transcript.final"
        ? refusedAck("payload_too_large")
        : undefined;
    await say("e1");
    expect(companion.snapshot().phase).toBe("listening");
    expect(companion.snapshot().notices[0]?.code).toBe("payload_too_large");
  });
});

describe("local stop", () => {
  it("stops synchronously with Studio permanently down and sends nothing more", async () => {
    const { companion, studio, capture, say, clock } = setup();
    studio.down = true;
    await companion.start();
    await say("e1");
    await say("e2");
    expect(companion.pending).toBe(2);
    expect(capture.active().length).toBe(2);

    const farewell = companion.stopLocally();
    // [TRACE] Everything below is observed BEFORE the farewell is awaited.
    expect(capture.active()).toEqual([]);
    expect(companion.pending).toBe(0);
    expect(companion.snapshot().phase).toBe("stopped-locally");
    await farewell;

    // One best-effort attempt each: a disconnect per source, then the idle beat.
    const farewellRequests = studio.requests.slice(-3);
    expect(
      farewellRequests.map((request) => [
        request.message.kind,
        (request.message.content as { reason?: string } | undefined)?.reason ??
          request.message.capturing,
      ]),
    ).toEqual([
      ["source.disconnected", "user-stopped"],
      ["source.disconnected", "user-stopped"],
      ["heartbeat", false],
    ]);
    const sent = studio.requests.length;
    await say("after-stop");
    await companion.flush();
    await clock.advance(60_000);
    await companion.tick();
    await companion.heartbeat();
    await companion.start();
    await companion.run();
    expect(studio.requests).toHaveLength(sent);
    expect(companion.snapshot().phase).toBe("stopped-locally");
    // A second stop is a no-op.
    await companion.stopLocally();
    expect(studio.requests).toHaveLength(sent);
  });

  it("is final even when Studio later says resume", async () => {
    const { companion, studio, capture } = setup();
    await companion.start();
    await companion.stopLocally();
    studio.state = "active";
    await companion.heartbeat();
    expect(capture.log.filter((entry) => entry.startsWith("start:"))).toEqual([
      "start:microphone",
      "start:application-audio",
    ]);
    expect(companion.snapshot().phase).toBe("stopped-locally");
  });

  it("ignores an acknowledgement that arrives after the stop", async () => {
    const { companion, studio, capture, say } = setup();
    await companion.start();
    let release: (() => void) | undefined;
    const original = studio.fetch;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    studio.fetch = async (url, init) => {
      const response = await original(url, init);
      if (first && String(init.body).includes("transcript.final")) {
        first = false;
        await held;
      }
      return response;
    };
    const sending = say("e1");
    await Promise.resolve();
    void companion.stopLocally();
    release?.();
    await sending;
    expect(companion.snapshot().phase).toBe("stopped-locally");
    expect(capture.active()).toEqual([]);
  });
});

describe("capability failure is visible", () => {
  it("starts no source, reports why and heartbeats capturing:false", async () => {
    const { companion, studio, capture, say } = setup({
      probeCapability: () => speechUnavailableDevice("en-GB"),
    });
    await companion.start();
    expect(capture.log).toEqual([]);
    expect(kinds(studio.requests)).toEqual(["capability.report", "heartbeat"]);
    expect(studio.requests[0]?.message).toMatchObject({
      speech: { onDeviceAvailable: false },
    });
    expect(studio.requests[1]?.message).toMatchObject({ capturing: false });
    const snapshot = companion.snapshot();
    expect(snapshot.phase).toBe("speech-unavailable");
    expect(snapshot.notices).toEqual([{ code: "on-device-unavailable" }]);
    await say("e1");
    expect(transcripts(studio.requests)).toEqual([]);
  });

  it("a probe that throws is the same visible failure and sends no report", async () => {
    const { companion, studio, capture } = setup({
      probeCapability: () => {
        throw new Error("platform detail");
      },
    });
    await companion.start();
    expect(capture.log).toEqual([]);
    expect(kinds(studio.requests)).toEqual(["heartbeat"]);
    expect(companion.snapshot().phase).toBe("speech-unavailable");
    expect(companion.snapshot().notices).toEqual([{ code: "probe-failed" }]);
  });

  it("a later resume does not start sources on a Mac that cannot do speech", async () => {
    const { companion, studio, capture, clock } = setup({
      probeCapability: () => speechUnavailableDevice(),
    });
    await companion.start();
    studio.state = "paused";
    await clock.advance(5000);
    await companion.heartbeat();
    studio.state = "active";
    await clock.advance(5000);
    await companion.heartbeat();
    expect(capture.log.filter((entry) => entry.startsWith("start:"))).toEqual(
      [],
    );
  });
});

describe("source loss", () => {
  it("shows permission revoked and never listening, and tells Studio", async () => {
    const { companion, studio, capture } = setup();
    await companion.start();
    const phases = [companion.snapshot().phase];
    await companion.reportSourceLoss("microphone", "permission-revoked");
    phases.push(companion.snapshot().phase);
    expect(phases).toEqual(["listening", "permission-revoked"]);
    expect(capture.active()).toEqual(["application-audio"]);
    const tail = studio.requests.slice(-2).map((request) => request.message);
    expect(tail[0]).toMatchObject({
      kind: "source.disconnected",
      content: { source: "microphone", reason: "permission-revoked" },
    });
    expect(tail[1]).toMatchObject({
      kind: "capture.gap",
      content: { source: "microphone", reason: "source-interrupted" },
    });
    // The other source still listening does not hide the revocation.
    await companion.heartbeat();
    expect(companion.snapshot().phase).toBe("permission-revoked");
    expect(companion.snapshot().sources.microphone).toBe("permission-revoked");
  });

  it("a lost device is source-lost, and restoring it listens again", async () => {
    const { companion, capture } = setup();
    await companion.start();
    await companion.reportSourceLoss("application-audio", "device-lost");
    expect(companion.snapshot().phase).toBe("source-lost");
    // Reports for a source that is not capturing are ignored.
    await companion.reportSourceLoss("application-audio", "device-lost");
    companion.restoreSource("microphone");
    companion.restoreSource("application-audio");
    expect(companion.snapshot().phase).toBe("listening");
    expect(capture.active()).toContain("application-audio");
  });

  it("a revoked source stays stopped across pause and resume, and is quiet while paused", async () => {
    const { companion, studio, capture, clock } = setup();
    await companion.start();
    studio.state = "paused";
    await clock.advance(5000);
    await companion.heartbeat();
    const sent = studio.requests.length;
    // Paused: no capture is running, so a loss report has nothing to stop.
    await companion.reportSourceLoss("microphone", "permission-revoked");
    expect(studio.requests).toHaveLength(sent);
    studio.state = "active";
    await clock.advance(5000);
    await companion.heartbeat();
    expect(capture.active()).toEqual(["microphone", "application-audio"]);
  });

  it("cannot restore a source while paused", async () => {
    const { companion, studio, capture, clock } = setup();
    await companion.start();
    await companion.reportSourceLoss("microphone", "permission-revoked");
    studio.state = "paused";
    await clock.advance(5000);
    await companion.heartbeat();
    companion.restoreSource("microphone");
    expect(capture.active()).toEqual([]);
  });
});

describe("screenshots", () => {
  const shot = (windowLabel = "Editor") => ({
    payload: new Uint8Array([1, 2, 3]),
    mediaType: "image/png" as const,
    windowLabel,
  });

  it("sends a selected-window screenshot as multipart and respects the cap", async () => {
    const { companion, studio } = setup({
      sources: ["screen"],
      maxScreenshots: 1,
    });
    await companion.start();
    await companion.observeScreenshot(shot());
    await companion.observeScreenshot(shot());
    const sent = studio.requests.filter(
      (request) => request.message.kind === "screen.snapshot",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payloadBytes).toBe(3);
    expect(companion.snapshot().notices).toEqual([
      { code: "screenshot-cap", source: "screen" },
    ]);
  });

  it("refuses to send an invalid screenshot, and ignores an unselected screen", async () => {
    const selected = setup({ sources: ["screen"] });
    await selected.companion.start();
    await selected.companion.observeScreenshot(shot("x".repeat(300)));
    expect(
      selected.studio.requests.filter(
        (request) => request.message.kind === "screen.snapshot",
      ),
    ).toEqual([]);
    expect(selected.companion.snapshot().notices).toEqual([
      { code: "invalid_message", source: "screen" },
    ]);

    const unselected = setup({ sources: ["microphone"] });
    await unselected.companion.start();
    await unselected.companion.observeScreenshot(shot());
    expect(
      unselected.studio.requests.filter(
        (request) => request.message.kind === "screen.snapshot",
      ),
    ).toEqual([]);
  });
});

describe("secrets and content stay out", () => {
  it("never puts the credential in a URL and sends it only as a bearer header", async () => {
    const { companion, studio, say, clock } = setup({
      sources: ["microphone", "screen"],
    });
    await companion.start();
    await say("e1");
    await companion.observeScreenshot({
      payload: new Uint8Array([1]),
      mediaType: "image/png",
      windowLabel: "Editor",
    });
    await companion.reportSourceLoss("microphone", "device-lost");
    await clock.advance(5000);
    await companion.heartbeat();
    await companion.stopLocally();
    expect(studio.requests.length).toBeGreaterThan(5);
    for (const request of studio.requests) {
      expect(request.url).not.toContain(FAKE_CREDENTIAL);
      expect(request.url).not.toContain("?");
      expect(request.headers.Authorization).toBe(`Bearer ${FAKE_CREDENTIAL}`);
      expect(JSON.stringify(request.message)).not.toContain(FAKE_CREDENTIAL);
    }
  });

  it("never lets the credential into an error message", () => {
    const secret = `asc_${"!".repeat(43)}`;
    for (const credential of [secret, "", "short"]) {
      try {
        setup({ credential });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CompanionError);
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).toBe("credential_malformed");
      }
    }
  });

  it("holds no transcript text in its state, notices or thrown errors", async () => {
    const { companion, studio, say } = setup();
    await companion.start();
    studio.script = (request) =>
      request.message.kind === "transcript.final"
        ? refusedAck("invalid_observation", "active")
        : undefined;
    await say("e1");
    await companion.reportSourceLoss("microphone", "permission-revoked");
    await companion.stopLocally();
    const serialised = JSON.stringify(companion.snapshot());
    expect(serialised).not.toContain(MARKER);
    expect(serialised).not.toContain("SYNTHETIC");
    const invalid = await companion.observeTranscript({
      eventId: "bad",
      source: "microphone",
      text: MARKER,
      startMs: 5,
      endMs: 1,
    });
    expect(invalid).toBeUndefined();
  });

  it("refuses an inverted transcript without leaking its text", async () => {
    const { companion, studio } = setup();
    await companion.start();
    await companion.observeTranscript({
      eventId: "bad",
      source: "microphone",
      text: MARKER,
      startMs: 5,
      endMs: 1,
    });
    expect(transcripts(studio.requests)).toEqual([]);
    expect(JSON.stringify(companion.snapshot())).not.toContain(MARKER);
    expect(companion.snapshot().notices).toEqual([
      { code: "invalid_message", source: "microphone" },
    ]);
  });
});

const FAR = "2099-01-01T00:00:00.000Z";

describe("capture requests", () => {
  const request = (
    requestId = "cap-1",
    mode: CaptureRequest["mode"] = "focused-window",
  ): CaptureRequest => ({
    requestId,
    mode,
    expiresAt: FAR,
  });
  const snapshots = (requests: RecordedRequest[]) =>
    requests.filter((entry) => entry.message.kind === "screen.snapshot");

  it("captures once for a request handed over on an acknowledgement and tags the snapshot with its id", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    studio.capture = request();
    await companion.start();
    expect(capture.captured).toEqual([request()]);
    const sent = snapshots(studio.requests);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.content).toMatchObject({
      requestId: "cap-1",
      windowLabel: "Editor",
      mediaType: "image/jpeg",
    });
    expect(sent[0]?.payloadBytes).toBeGreaterThan(0);
    expect(studio.fulfilled).toEqual(["cap-1"]);
  });

  it("carries the region through to the driver", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    const bound = {
      requestId: "cap-r",
      mode: "region" as const,
      region,
      selection: "disp-1.1",
      expiresAt: FAR,
    };
    studio.capture = bound;
    await companion.start();
    expect(capture.captured).toEqual([bound]);
  });

  it("ignores a repeat of the same id, and takes a newer one", async () => {
    const { companion, studio, capture, clock } = setup({
      sources: ["screen"],
    });
    studio.capture = request();
    // The answer to the snapshot still carries the request (a stale Studio).
    studio.script = (message) =>
      message.message.kind === "screen.snapshot"
        ? acceptedAck(message.message, "active", request())
        : undefined;
    await companion.start();
    await clock.advance(2000);
    await companion.tick();
    await clock.advance(2000);
    await companion.tick();
    expect(capture.captured).toHaveLength(1);
    studio.script = undefined;
    studio.capture = request("cap-2", "display");
    await clock.advance(2000);
    await companion.tick();
    expect(capture.captured.map((entry) => entry.requestId)).toEqual([
      "cap-1",
      "cap-2",
    ]);
  });

  it("is also handed a request on a refusal's control", async () => {
    const { companion, studio, capture, clock } = setup({
      sources: ["screen"],
    });
    await companion.start();
    studio.script = (message) =>
      message.message.kind === "heartbeat"
        ? refusedAck("rate_limited", "active", request())
        : undefined;
    await clock.advance(2000);
    await companion.tick();
    expect(capture.captured).toEqual([request()]);
  });

  it("pulls every two seconds while the screen runs, and keeps the slower cadence otherwise", async () => {
    const screen = setup({ sources: ["screen"] });
    await screen.companion.start();
    const before = screen.studio.requests.length;
    await screen.clock.advance(2000);
    await screen.companion.tick();
    expect(screen.studio.requests.length).toBe(before + 1);

    const audio = setup({ sources: ["microphone"] });
    await audio.companion.start();
    const quiet = audio.studio.requests.length;
    await audio.clock.advance(2000);
    await audio.companion.tick();
    expect(audio.studio.requests.length).toBe(quiet);
  });

  it("honours a request only for a screen source selected at start", async () => {
    const { companion, studio, capture } = setup({ sources: ["microphone"] });
    studio.capture = request();
    await companion.start();
    expect(capture.captured).toEqual([]);
    expect(snapshots(studio.requests)).toEqual([]);
    expect(companion.snapshot().notices).toContainEqual({
      code: "capture-request-ignored",
      source: "screen",
    });
  });

  it("captures nothing while Studio has paused capture", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    await companion.start();
    studio.state = "paused";
    studio.capture = request();
    await companion.heartbeat();
    await companion.tick();
    expect(capture.captured).toEqual([]);
    expect(snapshots(studio.requests)).toEqual([]);
  });

  it("reports a focused window it could not find as a visible loss and sends nothing wider", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    capture.nextCapture = { kind: "lost", code: "no-focused-window" };
    studio.capture = request();
    await companion.start();
    expect(capture.captured).toHaveLength(1);
    expect(snapshots(studio.requests)).toEqual([]);
    expect(companion.snapshot().notices).toContainEqual({
      code: "no-focused-window",
      source: "screen",
    });
  });

  it("sends nothing captured once the session ended while capturing", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    await companion.start();
    const driver = capture.captureOnce.bind(capture);
    capture.captureOnce = async (asked, focus) => {
      const result = await driver(asked, focus);
      studio.state = "ended";
      await companion.heartbeat();
      return result;
    };
    studio.capture = request();
    await companion.heartbeat();
    await companion.tick();
    expect(snapshots(studio.requests)).toEqual([]);
  });
  it("declares what it understands on every request, with the screen selection", async () => {
    const { companion, studio } = setup({ sources: ["screen"] });
    await companion.start();
    for (const entry of studio.requests) {
      expect(entry.headers["x-companion-features"]).toBe("capture-request.v1");
      expect(entry.headers["x-companion-screen"]).toBe("disp-1.1");
    }
  });

  it("works against an older Studio: nothing is handed over, nothing unknown is sent", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    studio.legacy = true;
    studio.capture = request();
    await companion.start();
    await companion.tick();
    expect(capture.captured).toEqual([]);
    expect(
      studio.requests.some((entry) => entry.message.kind === "capture.failure"),
    ).toBe(false);
    expect(companion.snapshot().phase).toBe("listening");
  });

  it("samples the focused window when the request is taken, and hands that sample to the capture", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    capture.focus = "focus-at-take";
    studio.capture = request("cap-f", "focused-window");
    await companion.start();
    expect(capture.focusUsed).toEqual(["focus-at-take"]);
    // Other modes take no focus sample.
    capture.focus = "later";
    studio.capture = request("cap-d", "display");
    await companion.tick();
    await companion.heartbeat();
    await companion.tick();
    expect(capture.focusUsed.at(-1)).toBeUndefined();
  });

  it.each([
    "no-focused-window",
    "permission-denied",
    "capture-failed",
  ] as const)(
    "reports a %s loss to Studio as a typed failure for that request",
    async (code) => {
      const { companion, studio, capture } = setup({ sources: ["screen"] });
      capture.nextCapture = { kind: "lost", code };
      studio.capture = request();
      await companion.start();
      const sent = studio.requests.filter(
        (entry) => entry.message.kind === "capture.failure",
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]?.message).toMatchObject({ requestId: "cap-1", code });
      expect(Object.keys(sent[0]?.message ?? {}).sort()).toEqual([
        "code",
        "kind",
        "requestId",
        "sentAt",
        "sourceId",
        "version",
      ]);
      expect(studio.failures).toEqual([{ requestId: "cap-1", code }]);
      expect(snapshots(studio.requests)).toEqual([]);
    },
  );

  it("reports source-gone when the screen source cannot honour it", async () => {
    const { companion, studio } = setup({ sources: ["microphone"] });
    studio.capture = request();
    await companion.start();
    expect(studio.failures).toEqual([
      { requestId: "cap-1", code: "source-gone" },
    ]);
  });

  it("reports source-changed instead of cropping when the selection moved", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    capture.selection = "disp-1.2";
    studio.capture = {
      requestId: "cap-r",
      mode: "region",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
      selection: "disp-1.1",
      expiresAt: FAR,
    };
    await companion.start();
    expect(capture.captured).toEqual([]);
    expect(studio.failures).toEqual([
      { requestId: "cap-r", code: "source-changed" },
    ]);
  });

  it("captures nothing at or after the request's deadline", async () => {
    const { companion, studio, capture } = setup({ sources: ["screen"] });
    studio.capture = { ...request(), expiresAt: "1970-01-01T00:00:00.000Z" };
    await companion.start();
    expect(capture.captured).toEqual([]);
    expect(snapshots(studio.requests)).toEqual([]);
    expect(companion.snapshot().notices).toContainEqual({
      code: "capture-request-expired",
      source: "screen",
    });
  });

  it("retries an undelivered failure with the same message", async () => {
    const { companion, studio, capture, clock } = setup({
      sources: ["screen"],
    });
    capture.nextCapture = { kind: "lost", code: "no-focused-window" };
    studio.capture = request();
    studio.script = (entry) =>
      entry.message.kind === "capture.failure" ? "network-error" : undefined;
    await companion.start();
    studio.script = undefined;
    await clock.advance(5000);
    await companion.tick();
    expect(studio.failures).toEqual([
      { requestId: "cap-1", code: "no-focused-window" },
    ]);
  });
});

describe("voice activity", () => {
  const reports = (requests: RecordedRequest[]) =>
    requests
      .filter((request) => request.message.kind === "voice.activity")
      .map((request) => [
        request.message["source"],
        request.message["speaking"],
      ]);

  it("tells a change at once, keeps a voice alive about once a second, and never queues a report", async () => {
    const { companion, studio, clock } = setup();
    await companion.start();
    // Asked four times a second, as the companion's pass does.
    const pass = async (speaking: boolean, times: number) => {
      for (let at = 0; at < times; at += 1) {
        await companion.reportVoiceActivity("application-audio", speaking);
        await clock.advance(250);
      }
    };
    await pass(false, 4);
    await pass(true, 12);
    await pass(false, 4);
    expect(reports(studio.requests)).toEqual([
      ["application-audio", false],
      ["application-audio", true],
      ["application-audio", true],
      ["application-audio", true],
      ["application-audio", false],
    ]);
    const sent = studio.requests.find(
      (request) => request.message.kind === "voice.activity",
    );
    // The session credential, the ingest route, and nothing of the audio.
    expect(sent?.headers.Authorization).toBe(`Bearer ${FAKE_CREDENTIAL}`);
    expect(sent?.url).toMatch(/\/sessions\/ingest$/);
    expect(Object.keys(sent?.message ?? {}).sort()).toEqual([
      "kind",
      "sentAt",
      "source",
      "sourceId",
      "speaking",
      "version",
    ]);
    expect(companion.pending).toBe(0);
  });

  it("sends nothing more for the run once Studio says it is off, or does not know the message", async () => {
    for (const legacy of [false, true]) {
      const { companion, studio, clock } = setup();
      studio.legacy = legacy;
      if (!legacy)
        studio.script = (request) =>
          request.message.kind === "voice.activity"
            ? refusedAck("voice_activity_off", "active")
            : undefined;
      await companion.start();
      for (let at = 0; at < 8; at += 1) {
        await companion.reportVoiceActivity("microphone", at % 2 === 0);
        await clock.advance(1_500);
      }
      expect(reports(studio.requests)).toHaveLength(1);
      // Everything else carries on.
      expect(companion.snapshot().phase).toBe("listening");
    }
  });

  it("says a report again after one that did not get through, and nothing for a source it does not have", async () => {
    const { companion, studio, clock } = setup({ sources: ["microphone"] });
    await companion.start();
    await companion.reportVoiceActivity("application-audio", true);
    expect(reports(studio.requests)).toEqual([]);
    studio.script = (request) =>
      request.message.kind === "voice.activity" ? "network-error" : undefined;
    await companion.reportVoiceActivity("microphone", true);
    await companion.reportVoiceActivity("microphone", true);
    expect(reports(studio.requests)).toHaveLength(1);
    studio.script = undefined;
    await clock.advance(1_000);
    await companion.reportVoiceActivity("microphone", true);
    expect(reports(studio.requests)).toHaveLength(2);
    expect(companion.pending).toBe(0);
  });
});
