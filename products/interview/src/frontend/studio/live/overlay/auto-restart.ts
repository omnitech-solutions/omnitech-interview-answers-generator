// Keeps continuous listening alive without a restart storm. The browser ends a
// recognition session after silence or an error; a run that lived a while or
// heard something restarts at once, and one that dies young waits longer each
// time (doubling, capped) until a run is healthy again. Pure: a clock in, a
// delay out.
export const RESTART_BASE_MS = 500;
export const RESTART_MAX_MS = 15_000;
// A run at least this long counts as healthy.
export const HEALTHY_RUN_MS = 8_000;

export type RestartPolicy = {
  started(nowMs: number): void;
  heard(): void;
  // The run ended: how long to wait before starting the next one.
  ended(nowMs: number): number;
  reset(): void;
};

export function createRestartPolicy(): RestartPolicy {
  let startedAt = 0;
  let produced = false;
  let failures = 0;
  return {
    started(nowMs) {
      startedAt = nowMs;
      produced = false;
    },
    heard() {
      produced = true;
    },
    ended(nowMs) {
      if (produced || nowMs - startedAt >= HEALTHY_RUN_MS) {
        failures = 0;
        return 0;
      }
      failures += 1;
      // The first early end restarts at once (a normal silence timeout); each
      // further one waits twice as long, up to the cap.
      if (failures === 1) return 0;
      return Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** (failures - 2));
    },
    reset() {
      failures = 0;
      produced = false;
    },
  };
}
