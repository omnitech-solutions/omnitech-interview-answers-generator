import { describe, expect, it } from "vitest";
import { createBackoff } from "./backoff";

describe("backoff", () => {
  it("doubles the ceiling each failure and caps it", () => {
    const backoff = createBackoff({
      baseMs: 1000,
      maxMs: 8000,
      jitter: () => 1,
    });
    expect([1, 2, 3, 4, 5].map(() => backoff.next())).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
  });

  it("keeps half the delay at zero jitter and spreads the rest", () => {
    const low = createBackoff({ baseMs: 1000, jitter: () => 0 });
    const high = createBackoff({ baseMs: 1000, jitter: () => 0.999 });
    expect(low.next()).toBe(500);
    expect(high.next()).toBe(1000);
  });

  it("starts from the base again after a reset", () => {
    const backoff = createBackoff({ jitter: () => 1 });
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(1000);
  });

  it("falls back to Math.random when no jitter is injected", () => {
    const delay = createBackoff().next();
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(1000);
  });
});
