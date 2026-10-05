// A virtual clock: time moves only when a test says so, so a replay at 4x
// takes no real time and its elapsed time is exact.
import type { Clock } from "../clock";
import { CompanionError } from "../errors";

type Timer = { at: number; resolve: () => void };

const DEFAULT_START_MS = Date.UTC(2026, 9, 3, 10, 0, 0);
// Lets every promise continuation (including the companion's own awaits) run
// before the clock decides whether anything is left to wait for.
const settleMicrotasks = () => new Promise<void>((r) => setImmediate(r));

export class VirtualClock implements Clock {
  readonly startedAt: number;
  private time: number;
  private timers: Timer[] = [];

  constructor(startMs: number = DEFAULT_START_MS) {
    this.startedAt = startMs;
    this.time = startMs;
  }

  now(): number {
    return this.time;
  }

  get elapsedMs(): number {
    return this.time - this.startedAt;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push({ at: this.time + Math.max(0, ms), resolve });
    });
  }

  // Moves time forward, firing due timers in order.
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      await settleMicrotasks();
      const next = this.earliest();
      if (!next || next.at > target) break;
      this.fire(next);
    }
    this.time = target;
    await settleMicrotasks();
  }

  // Runs `work` to completion by jumping to each pending timer in turn. A
  // piece of work that is waiting on nothing the clock controls is a
  // deadlock, reported as a fixed code.
  async drive<T>(work: Promise<T>): Promise<T> {
    let outcome: { value: T } | { error: unknown } | undefined;
    work.then(
      (value) => {
        outcome = { value };
      },
      (error: unknown) => {
        outcome = { error };
      },
    );
    for (;;) {
      await settleMicrotasks();
      if (outcome) break;
      const next = this.earliest();
      if (!next) {
        await settleMicrotasks();
        if (outcome) break;
        throw new CompanionError("clock_deadlock");
      }
      this.fire(next);
    }
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }

  private earliest(): Timer | undefined {
    return this.timers.reduce<Timer | undefined>(
      (best, timer) => (!best || timer.at < best.at ? timer : best),
      undefined,
    );
  }

  private fire(timer: Timer): void {
    this.timers = this.timers.filter((candidate) => candidate !== timer);
    this.time = Math.max(this.time, timer.at);
    timer.resolve();
  }
}
