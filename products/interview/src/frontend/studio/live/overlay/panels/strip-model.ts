// The status strip under the toolbar: what the window is doing right now, as one
// table of states. The first state whose condition holds is the one shown, so
// priority is the order of the table and nothing else decides it. Pure.
import type { IconName } from "../../../icon";
import type { TaskView } from "../../session-tasks";
import type { AutoLine } from "../auto-line";
import { nativeChord } from "./toolbar-config";

type StripTone = "neutral" | "accent" | "green" | "amber";
export type StripActionId = "stop" | "resume";

export type StripInput = {
  paused: boolean;
  // Work in flight: the step it is at, the seconds it has taken, and the
  // newest task (what the work is for), when there is one.
  busy: { label: string; seconds: number } | null;
  // The newest task: its number and whether its answer is already published.
  newest: { label: string; answered: boolean } | null;
  auto: {
    // The owner's Auto line (its problem or wait text), or null.
    line: AutoLine | null;
    // Auto is watching the screen: on, a screen is wanted, and the analysis shows.
    watching: boolean;
    intervalSec: number;
  };
  // The newest task finished its work this many seconds ago, or null.
  finished: { label: string; tookSeconds: number } | null;
};

export type StripState = {
  id: "paused" | "busy" | "auto-problem" | "auto-watching" | "finished";
  tone: StripTone;
  // A spinner stands for work in flight; otherwise the icon.
  busy: boolean;
  icon: IconName | null;
  label: string;
  sub: string | null;
  action: { id: StripActionId; label: string; title: string } | null;
};

type Entry = {
  id: StripState["id"];
  when(input: StripInput): boolean;
  show(input: StripInput): Omit<StripState, "id">;
};

const STRIP_TABLE: readonly Entry[] = [
  {
    id: "paused",
    when: (input) => input.paused,
    show: () => ({
      tone: "amber",
      busy: false,
      icon: "pause_circle",
      label: "Paused",
      sub: "Nothing is captured and no new work starts",
      action: {
        id: "resume",
        label: "Resume",
        title: "Carry on listening and analysing",
      },
    }),
  },
  {
    id: "busy",
    when: (input) => input.busy !== null,
    show: (input) => ({
      tone: "neutral",
      busy: true,
      icon: null,
      label: `${input.busy?.label}${
        input.busy && input.busy.seconds >= 3 ? ` · ${input.busy.seconds}s` : ""
      }`,
      sub: input.newest
        ? `${input.newest.label}${input.newest.answered ? " · answer ready" : ""}`
        : null,
      action: {
        id: "stop",
        label: "Stop analysis",
        title:
          "Stop all analysis in this session. The session stays open and nothing is published for what was running",
      },
    }),
  },
  {
    id: "auto-problem",
    when: (input) => input.auto.line !== null && input.auto.line.tone !== "ok",
    show: (input) => ({
      tone: "amber",
      busy: false,
      icon: input.auto.line?.tone === "problem" ? "warning" : "schedule",
      label: input.auto.line?.text ?? "",
      sub: null,
      action: null,
    }),
  },
  {
    id: "auto-watching",
    when: (input) => input.auto.watching && input.auto.line !== null,
    show: (input) => ({
      tone: "accent",
      busy: false,
      icon: "visibility",
      label: "Auto · watching the screen",
      sub: `checks every ${input.auto.intervalSec} s · only while a browser is in front`,
      action: null,
    }),
  },
  {
    id: "finished",
    when: (input) => input.finished !== null,
    show: (input) => ({
      tone: "green",
      busy: false,
      icon: "check_circle",
      label: `Finished · ${input.finished?.tookSeconds}s`,
      sub: `${input.finished?.label} · press ${nativeChord("analyze")} for the next problem`,
      action: null,
    }),
  },
];

export function stripState(input: StripInput): StripState | null {
  const entry = STRIP_TABLE.find((each) => each.when(input));
  return entry ? { id: entry.id, ...entry.show(input) } : null;
}

// How long the "Finished" line stays after the work ends.
export const FINISHED_SHOWN_MS = 30_000;

// The newest task's total work time and how long ago it ended, from its own
// runs; null while anything is running, before any run, or once the line has
// been up long enough.
export function finishedWork(
  task: TaskView | undefined,
  label: string,
  nowMs: number,
): StripInput["finished"] {
  if (!task) return null;
  const runs = task.current.runs;
  if (runs.length === 0 || runs.some((run) => run.state === "running"))
    return null;
  const started = Math.min(...runs.map((run) => Date.parse(run.createdAt)));
  const ended = Math.max(...runs.map((run) => Date.parse(run.updatedAt)));
  if (
    Number.isNaN(started) ||
    Number.isNaN(ended) ||
    nowMs - ended > FINISHED_SHOWN_MS ||
    task.answer === null
  )
    return null;
  return {
    label,
    tookSeconds: Math.max(0, Math.round((ended - started) / 1000)),
  };
}
