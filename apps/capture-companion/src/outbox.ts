// A bounded, in-memory outbox. Every observation gets a stable
// (sourceId, eventId, sequence) at creation and keeps it across every resend,
// so Studio can deduplicate (rule:idempotent-observation). Nothing is written
// to disk: a stopped or crashed companion simply loses unsent buffers.
import type {
  CaptureSource,
  Observation,
} from "@omnitech/active-session-contracts";
import { type Clock, isoAt } from "./clock.js";
import { captureGapMessage } from "./messages.js";

export type OutboxEntry = {
  message: Observation;
  payload?: Uint8Array;
  // True once a send was tried; an untried gap may still absorb more overflow.
  attempted: boolean;
};

export type Allocation = {
  sourceId: string;
  eventId: string;
  occurredAt: string;
  sequence: number;
};

const isBufferable = (message: Observation) =>
  message.kind === "transcript.final" || message.kind === "screen.snapshot";

export class Outbox {
  private entries: OutboxEntry[] = [];
  private readonly sequences = new Map<string, number>();

  constructor(
    // The most transcript/screenshot entries held; gaps and disconnects are
    // exempt so the record of a loss can never be the thing that is lost.
    private readonly capacity: number,
    private readonly clock: Clock,
  ) {}

  get size(): number {
    return this.entries.length;
  }

  // Ids are assigned here, once. `eventId` is supplied when the source already
  // names its events (transcript segments); otherwise it derives from the
  // monotonic per-source sequence.
  allocate(sourceId: string, label: string, eventId?: string): Allocation {
    const sequence = this.sequences.get(sourceId) ?? 0;
    this.sequences.set(sourceId, sequence + 1);
    return {
      sourceId,
      eventId: eventId ?? `${sourceId}.${label}.${sequence}`,
      occurredAt: isoAt(this.clock.now()),
      sequence,
    };
  }

  enqueue(message: Observation, payload?: Uint8Array): void {
    this.entries.push({
      message,
      attempted: false,
      ...(payload ? { payload } : {}),
    });
    if (!isBufferable(message)) return;
    const buffered = this.entries.filter((entry) =>
      isBufferable(entry.message),
    );
    if (buffered.length <= this.capacity) return;
    const [oldest] = buffered;
    if (oldest) this.evict(oldest);
  }

  // The oldest entry, marked attempted because the caller is about to send it.
  head(): OutboxEntry | undefined {
    const entry = this.entries[0];
    if (entry) entry.attempted = true;
    return entry;
  }

  // Acknowledged (accepted or duplicate) or permanently refused.
  remove(sourceId: string, eventId: string): void {
    this.entries = this.entries.filter(
      (entry) =>
        entry.message.sourceId !== sourceId ||
        entry.message.eventId !== eventId,
    );
  }

  removeSource(sourceId: string): void {
    this.entries = this.entries.filter(
      (entry) => entry.message.sourceId !== sourceId,
    );
  }

  clear(): void {
    this.entries = [];
  }

  ids(): Array<{ sourceId: string; eventId: string; sequence: number }> {
    return this.entries.map(({ message }) => ({
      sourceId: message.sourceId,
      eventId: message.eventId,
      sequence: message.sequence,
    }));
  }

  // Drops the oldest bufferable entry and records the loss as a capture.gap.
  private evict(oldest: OutboxEntry): void {
    this.entries = this.entries.filter((entry) => entry !== oldest);
    const { message } = oldest;
    const lostMs =
      message.kind === "transcript.final"
        ? message.content.endMs - message.content.startMs
        : 0;
    // [DOMAIN] The companion names each observation's sourceId after its
    // capture source, so the gap's source is the sourceId.
    const source = message.sourceId as CaptureSource;
    // [INVARIANT] An untried gap for the same source absorbs the loss, so a
    // long outage grows one gap instead of one gap per dropped segment.
    const pending = this.entries.find(
      (entry) =>
        !entry.attempted &&
        entry.message.kind === "capture.gap" &&
        entry.message.sourceId === message.sourceId &&
        entry.message.content.reason === "buffer-overflow",
    );
    if (pending && pending.message.kind === "capture.gap") {
      pending.message = captureGapMessage({
        ...pending.message,
        content: {
          ...pending.message.content,
          durationMs: pending.message.content.durationMs + lostMs,
        },
      });
      return;
    }
    const ids = this.allocate(message.sourceId, "gap");
    this.entries.push({
      attempted: false,
      message: captureGapMessage({
        ...ids,
        content: { source, durationMs: lostMs, reason: "buffer-overflow" },
      }),
    });
  }
}
