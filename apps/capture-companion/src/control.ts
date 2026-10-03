// Control pull. The companion holds no control credential: Studio's control
// state reaches it only as `control.state` on every acknowledgement and
// refusal, which the heartbeat loop keeps flowing (rule:pause-only-credential-stop).
import type {
  CaptureSource,
  SessionControlState,
} from "@omnitech/active-session-contracts";

export type ControlTransition = "pause" | "resume" | "end" | "none";

// Turns Studio's reported state into at most one transition per change.
export class StudioControl {
  private current: SessionControlState = "active";

  get state(): SessionControlState {
    return this.current;
  }

  get paused(): boolean {
    return this.current === "paused";
  }

  observe(next: SessionControlState): ControlTransition {
    // [INVARIANT] Ended and purging are final: nothing resumes an ended run.
    if (this.current === "ended" || this.current === "purging") return "none";
    const previous = this.current;
    this.current = next;
    if (next === "ended" || next === "purging") return "end";
    if (next === "paused" && previous !== "paused") return "pause";
    if (next === "active" && previous === "paused") return "resume";
    return "none";
  }
}

// The sources the user selected locally, narrowed only by refusal. There is no
// way to add a source after construction: Studio cannot broaden the set
// (the wire has no message that names one).
export class SourceSelection {
  private readonly selected: ReadonlySet<CaptureSource>;
  private readonly refused = new Set<CaptureSource>();

  constructor(selected: readonly CaptureSource[]) {
    this.selected = new Set(selected);
  }

  has(source: CaptureSource): boolean {
    return this.selected.has(source);
  }

  // A source Studio refused is dropped for the rest of the run, never retried.
  refuse(source: CaptureSource): boolean {
    if (!this.selected.has(source) || this.refused.has(source)) return false;
    this.refused.add(source);
    return true;
  }

  isRefused(source: CaptureSource): boolean {
    return this.refused.has(source);
  }

  // What may (re)start: selected locally and not refused by Studio.
  eligible(): CaptureSource[] {
    return [...this.selected].filter((source) => !this.refused.has(source));
  }
}
