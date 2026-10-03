// The visible state machine. The companion shows exactly one phase, chosen so
// that nothing claims "listening" while a source is revoked, paused or the
// speech check failed. It holds no content: only phases, source names and
// fixed notice codes.
import type { CaptureSource } from "@omnitech/active-session-contracts";

export type CompanionPhase =
  | "connecting"
  | "listening"
  | "paused"
  | "source-lost"
  | "permission-revoked"
  | "speech-unavailable"
  | "stopped-locally"
  | "ended"
  | "credential-refused";

export type SourcePhase =
  | "idle"
  | "listening"
  | "lost"
  | "permission-revoked"
  | "refused";

export type TerminalPhase = Extract<
  CompanionPhase,
  "stopped-locally" | "ended" | "credential-refused"
>;

// A permanent refusal or local decision, surfaced to the user. Codes only.
export type CompanionNotice = { code: string; source?: CaptureSource };

export type CompanionSnapshot = {
  phase: CompanionPhase;
  sources: Partial<Record<CaptureSource, SourcePhase>>;
  notices: CompanionNotice[];
  // True once Studio has answered since the last failure.
  connected: boolean;
};

const MAX_NOTICES = 20;

export class StateModel {
  private terminal: TerminalPhase | undefined;
  private speechBlocked = false;
  private paused = false;
  private connected = false;
  private readonly sources = new Map<CaptureSource, SourcePhase>();
  private notices: CompanionNotice[] = [];

  get terminalPhase(): TerminalPhase | undefined {
    return this.terminal;
  }

  get speechUnavailable(): boolean {
    return this.speechBlocked;
  }

  setSource(source: CaptureSource, phase: SourcePhase): void {
    this.sources.set(source, phase);
  }

  sourcePhase(source: CaptureSource): SourcePhase {
    return this.sources.get(source) ?? "idle";
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeechBlocked(blocked: boolean): void {
    this.speechBlocked = blocked;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  // The first terminal phase wins: a stop is final for the run, and a later
  // Studio refusal cannot turn "stopped locally" into something else.
  terminate(phase: TerminalPhase): void {
    this.terminal ??= phase;
  }

  notice(notice: CompanionNotice): void {
    this.notices = [...this.notices, notice].slice(-MAX_NOTICES);
  }

  phase(): CompanionPhase {
    if (this.terminal) return this.terminal;
    if (this.speechBlocked) return "speech-unavailable";
    const phases = [...this.sources.values()];
    if (phases.includes("permission-revoked")) return "permission-revoked";
    if (this.paused) return "paused";
    if (phases.includes("lost")) return "source-lost";
    if (phases.includes("listening")) return "listening";
    return "connecting";
  }

  snapshot(): CompanionSnapshot {
    return {
      phase: this.phase(),
      sources: Object.fromEntries(this.sources),
      notices: [...this.notices],
      connected: this.connected,
    };
  }
}
