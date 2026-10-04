// The companion loop: pairing check, capture, a bounded outbox with resend,
// control pull on the heartbeat, and the stops. It speaks only the versioned
// wire (active-session-contracts), holds no database or provider credential,
// logs nothing, and can only narrow its sources (ADR-0011, ADR-0012).
import {
  ACTIVE_SESSION_LIMITS,
  type Acknowledgement,
  type CaptureRequest,
  type CaptureSource,
  type IngestMessage,
  type Observation,
  type ScreenSnapshot,
  type SessionControlState,
  validateIngestMessage,
} from "@omnitech/active-session-contracts";
import { type Backoff, createBackoff } from "./backoff.js";
import { type CapabilityProbe, probeCapability } from "./capability.js";
import type { CaptureDriver } from "./capture-driver.js";
import { type Clock, isoAt } from "./clock.js";
import { SourceSelection, StudioControl } from "./control.js";
import { stopLocally } from "./local-stop.js";
import {
  capabilityReportMessage,
  captureGapMessage,
  heartbeatMessage,
  screenSnapshotMessage,
  transcriptFinalMessage,
} from "./messages.js";
import { Outbox } from "./outbox.js";
import { recordSourceLoss, type SourceLossReason } from "./source-loss.js";
import {
  type CompanionSnapshot,
  StateModel,
  type TerminalPhase,
} from "./state.js";
import {
  createWireClient,
  type FetchLike,
  type SendOutcome,
  type WireClient,
} from "./wire-client.js";

// Heartbeat and capability messages are not capture sources.
const COMPANION_SOURCE_ID = "companion";
const DEFAULT_HEARTBEAT_MS = 5_000;
// While the screen source runs, Studio may hand over a capture-now request on
// any acknowledgement, so the heartbeat pulls faster to pick one up within a
// couple of seconds. Never faster than Studio's minimum spacing.
const SCREEN_PULL_MS = 2_000;
// Capture request ids already taken: a repeat on a later acknowledgement is
// ignored. Bounded so a long run holds no unbounded history.
const HANDLED_REQUESTS = 32;
const DEFAULT_OUTBOX_CAPACITY = 200;

export type CompanionOptions = {
  baseUrl: string;
  tenantSlug: string;
  credential: string;
  fetch: FetchLike;
  clock: Clock;
  capture: CaptureDriver;
  probeCapability: CapabilityProbe;
  // The sources the user chose locally; Studio can narrow but never add.
  sources: readonly CaptureSource[];
  heartbeatIntervalMs?: number;
  outboxCapacity?: number;
  maxScreenshots?: number;
  jitter?: () => number;
};

export type TranscriptInput = {
  eventId: string;
  source: "microphone" | "application-audio";
  text: string;
  startMs: number;
  endMs: number;
  supersedes?: string;
};

export type ScreenshotInput = {
  payload: Uint8Array;
  mediaType: ScreenSnapshot["content"]["mediaType"];
  windowLabel: string;
  // Only ever the id of the capture request just handed over.
  requestId?: string;
};

export class Companion {
  private readonly client: WireClient;
  private readonly clock: Clock;
  private readonly capture: CaptureDriver;
  private readonly outbox: Outbox;
  private readonly state = new StateModel();
  private readonly control = new StudioControl();
  private readonly selection: SourceSelection;
  private readonly backoff: Backoff;
  private readonly active = new Set<CaptureSource>();
  private readonly heartbeatIntervalMs: number;
  private readonly maxScreenshots: number;
  private pendingCapability: IngestMessage | undefined;
  // The capture request handed over and not yet taken, and the ids taken.
  private wantedCapture: CaptureRequest | undefined;
  private readonly handledRequests: string[] = [];
  private holdUntil = 0;
  private lastHeartbeatAt = Number.NEGATIVE_INFINITY;
  private pausedAt = 0;
  private screenshots = 0;
  private flushing: Promise<void> | undefined;
  private flushAgain = false;
  private started = false;

  constructor(private readonly options: CompanionOptions) {
    this.client = createWireClient(options);
    this.clock = options.clock;
    this.capture = options.capture;
    this.outbox = new Outbox(
      options.outboxCapacity ?? DEFAULT_OUTBOX_CAPACITY,
      options.clock,
    );
    this.selection = new SourceSelection(options.sources);
    this.backoff = createBackoff(
      options.jitter ? { jitter: options.jitter } : {},
    );
    // [GUARD] Never faster than Studio's minimum spacing.
    this.heartbeatIntervalMs = Math.max(
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS,
      ACTIVE_SESSION_LIMITS.minHeartbeatIntervalMs,
    );
    this.maxScreenshots =
      options.maxScreenshots ?? ACTIVE_SESSION_LIMITS.maxScreenshotsPerSession;
  }

  snapshot(): CompanionSnapshot {
    return this.state.snapshot();
  }

  // Observations queued and not yet acknowledged (content-free).
  get pending(): number {
    return this.outbox.size;
  }

  // ---- Startup: the capability report precedes every transcript. ----------
  async start(): Promise<void> {
    if (this.started || this.state.terminalPhase) return;
    this.started = true;
    const { device, verdict } = await probeCapability(
      this.options.probeCapability,
    );
    if (device) {
      this.pendingCapability = capabilityReportMessage({
        sourceId: COMPANION_SOURCE_ID,
        sentAt: isoAt(this.clock.now()),
        ...device,
      });
    }
    if (!verdict.ready) {
      // [SAFETY] Fail visibly: no source starts, and the heartbeat says so.
      this.state.setSpeechBlocked(true);
      for (const blocker of verdict.blockers) {
        this.state.notice({ code: blocker });
      }
    } else {
      this.startSources(this.selection.eligible());
    }
    await this.flush();
    await this.heartbeat();
    await this.fulfilCapture();
  }

  // ---- Observations in. ----------------------------------------------------
  async observeTranscript(input: TranscriptInput): Promise<void> {
    if (!this.accepting(input.source)) return;
    const message = transcriptFinalMessage({
      ...this.outbox.allocate(input.source, "transcript", input.eventId),
      content: {
        // [DOMAIN] The speaker is a source label, never a verified identity.
        speaker: input.source,
        source: input.source,
        text: input.text,
        startMs: input.startMs,
        endMs: input.endMs,
        ...(input.supersedes === undefined
          ? {}
          : { supersedes: input.supersedes }),
      },
    });
    if (this.enqueue(message)) await this.flush();
  }

  async observeScreenshot(input: ScreenshotInput): Promise<void> {
    if (!this.accepting("screen")) return;
    if (this.screenshots >= this.maxScreenshots) {
      this.state.notice({ code: "screenshot-cap", source: "screen" });
      return;
    }
    const ids = this.outbox.allocate("screen", "snapshot");
    const message = screenSnapshotMessage({
      ...ids,
      content: {
        payloadRef: ids.eventId,
        mediaType: input.mediaType,
        byteLength: input.payload.byteLength,
        windowLabel: input.windowLabel,
        ...(input.requestId === undefined
          ? {}
          : { requestId: input.requestId }),
      },
    });
    if (this.enqueue(message, input.payload)) {
      this.screenshots += 1;
      await this.flush();
    }
  }

  // The platform reports a revoked permission or a lost device.
  async reportSourceLoss(
    source: CaptureSource,
    reason: SourceLossReason,
  ): Promise<void> {
    if (this.state.terminalPhase || !this.active.has(source)) return;
    this.active.delete(source);
    recordSourceLoss(
      {
        capture: this.capture,
        outbox: this.outbox,
        state: this.state,
        queueing: !this.control.paused,
      },
      source,
      reason,
    );
    await this.flush();
  }

  // The user fixed the cause (re-granted a permission, reconnected a device).
  restoreSource(source: CaptureSource): void {
    const phase = this.state.sourcePhase(source);
    if (phase !== "permission-revoked" && phase !== "lost") return;
    this.state.setSource(source, "idle");
    if (this.canCapture()) this.startSources([source]);
  }

  // ---- The loop. -----------------------------------------------------------
  async run(): Promise<void> {
    await this.start();
    while (!this.state.terminalPhase) {
      await this.tick();
      if (this.state.terminalPhase) break;
      await this.clock.sleep(this.waitMs());
    }
  }

  async tick(): Promise<void> {
    if (this.clock.now() - this.lastHeartbeatAt >= this.pullIntervalMs()) {
      await this.heartbeat();
    }
    await this.flush();
    await this.fulfilCapture();
  }

  // One heartbeat: it keeps Studio's contact stamp fresh and, through its
  // acknowledgement, is how pause and end reach this companion.
  async heartbeat(): Promise<void> {
    if (this.state.terminalPhase || this.clock.now() < this.holdUntil) return;
    this.lastHeartbeatAt = this.clock.now();
    const outcome = await this.client.send(this.heartbeatNow());
    if (this.state.terminalPhase) return;
    this.settle(outcome);
  }

  // One drain at a time; a flush requested while one runs makes it go round
  // again, so a message queued at the last moment is never stranded.
  flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        await this.drain();
      } while (this.flushAgain);
    })().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  // LOCAL STOP: everything that matters is done before this returns its
  // promise; the promise only covers the best-effort goodbye.
  stopLocally(): Promise<void> {
    if (this.state.terminalPhase) return Promise.resolve();
    const sources = [...this.active];
    this.active.clear();
    return stopLocally({
      capture: this.capture,
      outbox: this.outbox,
      state: this.state,
      sources,
      sendOnce: (message) => this.client.send(message),
      heartbeatIdle: () => this.heartbeatNow(false),
    });
  }

  // ---- Internals. ----------------------------------------------------------
  // capturing:false asks Studio to pause the session, so it is sent only when
  // the companion itself has stopped. While Studio alone has paused capture the
  // companion is still doing what it was told, and says so; otherwise the
  // owner's resume would be undone by the very next heartbeat.
  private heartbeatNow(
    capturing = this.active.size > 0 ||
      (this.control.paused &&
        !this.state.terminalPhase &&
        !this.state.speechUnavailable),
  ) {
    return heartbeatMessage({
      sourceId: COMPANION_SOURCE_ID,
      sentAt: isoAt(this.clock.now()),
      capturing,
    });
  }

  private canCapture(): boolean {
    return (
      !this.state.terminalPhase &&
      !this.control.paused &&
      !this.state.speechUnavailable
    );
  }

  private accepting(source: CaptureSource): boolean {
    return this.canCapture() && this.active.has(source);
  }

  private startSources(sources: readonly CaptureSource[]): void {
    for (const source of sources) {
      const phase = this.state.sourcePhase(source);
      if (phase === "permission-revoked" || phase === "lost") continue;
      this.capture.start(source);
      this.active.add(source);
      this.state.setSource(source, "listening");
    }
  }

  // Validates before queueing: an invalid observation is the companion's own
  // fault and is dropped visibly instead of looping forever.
  private enqueue(message: Observation, payload?: Uint8Array): boolean {
    if (!validateIngestMessage(message).ok) {
      this.state.notice({
        code: "invalid_message",
        source: message.sourceId as CaptureSource,
      });
      return false;
    }
    this.outbox.enqueue(message, payload);
    return true;
  }

  private pullIntervalMs(): number {
    return this.active.has("screen")
      ? Math.max(
          Math.min(this.heartbeatIntervalMs, SCREEN_PULL_MS),
          ACTIVE_SESSION_LIMITS.minHeartbeatIntervalMs,
        )
      : this.heartbeatIntervalMs;
  }

  private waitMs(): number {
    const now = this.clock.now();
    // The next heartbeat is due one interval after the last, and not before a
    // Retry-After or backoff hold has passed.
    const heartbeatDue = Math.max(
      this.lastHeartbeatAt + this.pullIntervalMs(),
      this.holdUntil,
    );
    const heartbeatIn = Math.max(1, heartbeatDue - now);
    // An undelivered message is retried as soon as its hold ends.
    const retryIn = this.holdUntil - now;
    const waiting = this.outbox.size > 0 || this.pendingCapability;
    return waiting && retryIn > 0
      ? Math.min(heartbeatIn, retryIn)
      : heartbeatIn;
  }

  // Sends the oldest message first and strictly in order, resending the SAME
  // ids until Studio answers, then moves on. A failure sets a hold instead of
  // sleeping, so the loop (or a test clock) decides when to try again.
  private async drain(): Promise<void> {
    while (this.canCapture() || this.pendingCapability) {
      if (this.state.terminalPhase || this.clock.now() < this.holdUntil) return;
      if (this.pendingCapability) {
        const outcome = await this.client.send(this.pendingCapability);
        if (this.state.terminalPhase) return;
        if (this.settle(outcome)) return;
        this.pendingCapability = undefined;
        continue;
      }
      const entry = this.outbox.head();
      if (!entry) return;
      const outcome = await this.client.send(entry.message, entry.payload);
      if (this.state.terminalPhase) return;
      if (this.settle(outcome, entry.message)) return;
      this.outbox.remove(entry.message.sourceId, entry.message.eventId);
    }
  }

  // Applies Studio's answer. Returns true when the same message must be
  // resent later (unreachable, rate limited), false when it is finished.
  private settle(outcome: SendOutcome, message?: Observation): boolean {
    if (outcome.kind === "unreachable") {
      this.state.setConnected(false);
      this.holdUntil = this.clock.now() + this.backoff.next();
      return true;
    }
    this.state.setConnected(true);
    this.backoff.reset();
    const { ack } = outcome;
    if (ack.status !== "refused") {
      const { control } = ack.status === "accepted" ? ack : ack.original;
      this.applyControl(control.state);
      // [SAFETY] A duplicate carries the ORIGINAL ack, so only a fresh
      // acceptance can hand over a request.
      if (ack.status === "accepted") this.takeCapture(control.capture);
      return false;
    }
    if (ack.control) {
      this.applyControl(ack.control.state);
      this.takeCapture(ack.control.capture);
    }
    return this.applyRefusal(ack, outcome.retryAfterMs, message);
  }

  private applyRefusal(
    ack: Extract<Acknowledgement, { status: "refused" }>,
    retryAfterMs: number | undefined,
    message: Observation | undefined,
  ): boolean {
    switch (ack.code) {
      case "rate_limited":
        // [STRATEGY] Studio's Retry-After wins over our own backoff.
        this.holdUntil =
          this.clock.now() + (retryAfterMs ?? this.backoff.next());
        return true;
      case "credential_refused":
        this.terminate("credential-refused");
        return false;
      case "session_ended":
      case "session_purging":
        this.terminate("ended");
        return false;
      case "session_paused":
        this.applyControl("paused");
        return false;
      case "invalid_observation":
        this.refuseSource(message);
        return false;
      default:
        // payload_too_large, envelope_too_large, unsupported_version,
        // limit_reached, event_conflict: permanent for this message; it is
        // dropped and surfaced, never retried.
        this.state.notice({ code: ack.code, ...this.sourceOf(message) });
        return false;
    }
  }

  private sourceOf(message: Observation | undefined) {
    const source = message?.sourceId as CaptureSource | undefined;
    return source && this.selection.has(source) ? { source } : {};
  }

  // Narrowing only: a source Studio refused is dropped for the run.
  private refuseSource(message: Observation | undefined): void {
    const { source } = this.sourceOf(message);
    this.state.notice({
      code: "invalid_observation",
      ...this.sourceOf(message),
    });
    if (!source || !this.selection.refuse(source)) return;
    this.capture.stop(source);
    this.active.delete(source);
    this.outbox.removeSource(source);
    this.state.setSource(source, "refused");
  }

  // A capture request is taken ONCE per id: a repeat is ignored. It is only
  // remembered here; fulfilCapture runs it outside the acknowledgement path.
  private takeCapture(request: CaptureRequest | undefined): void {
    if (!request || this.state.terminalPhase) return;
    if (this.handledRequests.includes(request.requestId)) return;
    this.handledRequests.push(request.requestId);
    if (this.handledRequests.length > HANDLED_REQUESTS)
      this.handledRequests.shift();
    this.wantedCapture = request;
  }

  // Captures once for the request taken. [SAFETY] Honoured only while the
  // screen source the user selected at start is running (not paused, lost,
  // refused or never selected); anything else is ignored visibly. A capture
  // that finds nothing to capture is a visible loss, never a wider capture.
  private async fulfilCapture(): Promise<void> {
    const request = this.wantedCapture;
    this.wantedCapture = undefined;
    if (!request) return;
    if (!this.accepting("screen")) {
      this.state.notice({ code: "capture-request-ignored", source: "screen" });
      return;
    }
    const result = await this.capture.captureOnce(request);
    // The world may have changed while capturing: pause, end or a stop means
    // nothing captured is sent.
    if (!this.accepting("screen")) return;
    if (result.kind === "lost") {
      this.state.notice({ code: result.code, source: "screen" });
      return;
    }
    await this.observeScreenshot({
      payload: result.payload,
      mediaType: result.mediaType,
      windowLabel: result.windowLabel,
      requestId: request.requestId,
    });
  }

  private applyControl(next: SessionControlState): void {
    switch (this.control.observe(next)) {
      case "pause":
        this.pauseCapture();
        break;
      case "resume":
        this.resumeCapture();
        break;
      case "end":
        this.terminate("ended");
        break;
      case "none":
        break;
    }
  }

  // Pause drops buffers and stops every source (D7): nothing captured before
  // the pause is sent after it.
  private pauseCapture(): void {
    this.pausedAt = this.clock.now();
    this.capture.stopAll();
    this.outbox.clear();
    for (const source of this.active) this.state.setSource(source, "idle");
    this.active.clear();
    this.state.setPaused(true);
  }

  // Resume restarts only sources chosen locally and not refused by Studio.
  private resumeCapture(): void {
    this.state.setPaused(false);
    if (!this.canCapture()) return;
    const gapMs = this.clock.now() - this.pausedAt;
    this.startSources(this.selection.eligible());
    for (const source of this.active) {
      this.outbox.enqueue(
        captureGapMessage({
          ...this.outbox.allocate(source, "gap"),
          content: { source, durationMs: gapMs, reason: "paused" },
        }),
      );
    }
  }

  private terminate(phase: TerminalPhase): void {
    this.state.terminate(phase);
    this.capture.stopAll();
    this.outbox.clear();
    this.pendingCapability = undefined;
    for (const source of this.active) this.state.setSource(source, "idle");
    this.active.clear();
  }
}
