// Activity runs: one chip per action the session decided to run, saying what
// became of it. Pure: the state follows from the action's dispatch status, its
// suppression reason, whether its result was written to the Workspace, and
// whether the task revision and fence it ran under are still current.
import type {
  LiveAction,
  LiveSessionStatus,
} from "@omnitech/interview-contracts";
import {
  parseCodeResult,
  parseResultMeta,
  parseWithheldCodes,
  parseWithheldResult,
} from "./session-results";

export type RunState =
  // Its result is current and was published.
  | "published"
  // Work in flight for the current revision.
  | "running"
  // In flight, but pause, end or a newer revision means its result will be
  // discarded; it shows as cancelling until the server settles it.
  | "cancelling"
  // Settled without publishing because the task or fence moved on.
  | "discarded"
  // Settled without publishing because the session was paused or ended.
  | "cancelled"
  | "failed"
  // A policy refused it (device-only, assistance off, no on-device model).
  | "refused"
  // Published, but the Workspace draft was edited since, so the result is held
  // as a suggestion and nothing was overwritten.
  | "held-conflict"
  // Published for an earlier revision; a newer one replaced it.
  | "superseded";

export type RunTone = "green" | "amber" | "red" | "neutral" | "accent";

export type ActivityRun = {
  id: string;
  taskId: string;
  taskRevision: number;
  actionKind: string;
  kindLabel: string;
  state: RunState;
  label: string;
  tone: RunTone;
  // The server's fixed reason code, and a sentence for it when known.
  reason: string | null;
  reasonLabel: string | null;
  // A withheld draft: how many claims could not be checked (content-free).
  // null when the server did not record a count.
  rejectedClaimCount: number | null;
  // The closed violation codes of a withheld draft (never content).
  withheldCodes: string[];
  // The profile and policy the stage ran under, from its published result.
  profile: string | null;
  // The run belongs to the task's current revision.
  current: boolean;
  attempt: number;
  shown: boolean;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunContext = {
  currentRevision: number;
  // The newest holder fence seen across the session's actions.
  currentFence: number;
  sessionStatus: LiveSessionStatus;
};

const KIND_LABEL: Record<string, string> = {
  "draft-answer": "Answer draft",
  "solve-code": "Coding draft",
  "agent-solve": "Agent job",
};
const RUNNING_LABEL: Record<string, string> = {
  "draft-answer": "Drafting",
  "solve-code": "Testing",
  "agent-solve": "Working",
};
const STATE_PRESENTATION: Record<RunState, { label: string; tone: RunTone }> = {
  published: { label: "Published", tone: "green" },
  running: { label: "Running", tone: "accent" },
  cancelling: { label: "Cancelling", tone: "amber" },
  discarded: { label: "Discarded", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
  refused: { label: "Refused", tone: "red" },
  "held-conflict": { label: "Held", tone: "amber" },
  superseded: { label: "Superseded", tone: "neutral" },
};

// Suppression reasons the processor records, as a state and a sentence.
const SUPPRESSION: Record<string, { state: RunState; label: string }> = {
  session_paused: { state: "cancelled", label: "The session was paused." },
  session_ended: { state: "cancelled", label: "The session ended." },
  session_purging: {
    state: "cancelled",
    label: "The session is being deleted.",
  },
  revision_stale: {
    state: "discarded",
    label: "The task changed before this finished.",
  },
  constraint_changed: { state: "discarded", label: "A constraint changed." },
  source_superseded: {
    state: "discarded",
    label: "The words it was based on were corrected.",
  },
  fence_superseded: {
    state: "discarded",
    label: "Another worker took over this session.",
  },
  invalid_output: {
    state: "failed",
    label:
      "It could not be checked against your approved experience, so nothing was published.",
  },
  prompt_too_large: {
    state: "failed",
    label: "There was too much context for the model.",
  },
  policy_refused: {
    state: "refused",
    label: "The processing policy refused it.",
  },
  stage_unlisted: {
    state: "refused",
    label: "No on-device model is available for this step.",
  },
  runner_not_device_local: {
    state: "refused",
    label:
      "Device-only mode refused it: the test runner does not run on this Mac.",
  },
  assistance_disabled: {
    state: "refused",
    label: "Assistance is off for this session.",
  },
  job_refused: { state: "refused", label: "The agent job was refused." },
  // Screenshots fail closed (ADR-0016): never answered text-only.
  vision_unavailable: {
    state: "refused",
    label:
      "No screenshot-capable assistant is set up, so the capture was not analysed.",
  },
  vision_device_only: {
    state: "refused",
    label: "Device-only mode never sends a screenshot to an assistant.",
  },
  vision_refused: {
    state: "refused",
    label:
      "The assistant could not take this screenshot, so nothing was answered.",
  },
};

// What a bounded violation code means, in plain words. Closed table: a code
// the server adds later simply has no sentence, and nothing else is shown.
const FLAG_WORDS: Record<string, string> = {
  ungrounded_figure: "a number in the draft isn't in your experience",
  spoken_figure:
    "a number from the conversation isn't in your experience and was not repeated",
  ungrounded_logistics_figure:
    "a pay, notice or availability figure isn't in your preferences",
  preference_only_topic:
    "pay, notice or availability wasn't backed by your preferences",
  personal_claim_unsourced:
    "a statement about you or an employer isn't in your experience",
  generated_reason: "a reason for leaving was written for you",
  disparages_employer: "the draft criticised an employer",
  confusable_text: "the draft contained look-alike characters",
  unsupported_reference: "a claim went beyond the experience it cited",
  quote_mismatch: "a cited quote doesn't match your experience",
  unsupported_element: "a story element went beyond the experience it cited",
};
const MAX_FLAG_WORDS = 3;

export function flaggedBecause(codes: readonly string[]): string {
  const words = codes.flatMap((code) => {
    const sentence = FLAG_WORDS[code];
    return sentence ? [`${sentence} (${code})`] : [];
  });
  return words.length > 0
    ? ` Flagged: ${words.slice(0, MAX_FLAG_WORDS).join("; ")}.`
    : "";
}

// A withheld solution failed its structural checks (language, tests,
// constraint coverage); there is no approved experience involved.
const CODE_INVALID_OUTPUT_LABEL =
  "The generated solution did not pass its checks (language, tests and constraint coverage), so nothing was published.";

function stateOf(action: LiveAction, context: RunContext): RunState {
  const currentRevision = action.taskRevision >= context.currentRevision;
  switch (action.dispatchStatus) {
    case "in_flight": {
      const stopped =
        context.sessionStatus !== "active" &&
        context.sessionStatus !== "created";
      return stopped ||
        !currentRevision ||
        action.fenceAtDispatch < context.currentFence
        ? "cancelling"
        : "running";
    }
    case "succeeded": {
      if (parseCodeResult(action.result)?.workspace?.published === false)
        return "held-conflict";
      return currentRevision ? "published" : "superseded";
    }
    case "failed":
      return "failed";
    case "suppressed":
      return SUPPRESSION[action.suppressionReason ?? ""]?.state ?? "discarded";
    default:
      return "failed";
  }
}

// "Profile <id> · device-only policy": the policy is the session's setting when
// the stage ran, not a claim about where the model is hosted.
const POLICY_LABEL = {
  "device-only": "device-only policy",
  "permitted-remote": "remote processing allowed",
} as const;

function profileLine(result: unknown): string | null {
  const meta = parseResultMeta(result);
  return meta
    ? `Profile ${meta.profileId} · ${POLICY_LABEL[meta.processingPolicy]}`
    : null;
}

export function activityRun(
  action: LiveAction,
  context: RunContext,
): ActivityRun {
  const state = stateOf(action, context);
  const presentation = STATE_PRESENTATION[state];
  return {
    id: action.id,
    taskId: action.taskId,
    taskRevision: action.taskRevision,
    actionKind: action.actionKind,
    kindLabel: KIND_LABEL[action.actionKind] ?? "Work",
    state,
    label:
      state === "running"
        ? (RUNNING_LABEL[action.actionKind] ?? "Running")
        : presentation.label,
    tone: presentation.tone,
    reason: action.suppressionReason,
    reasonLabel:
      action.suppressionReason === "invalid_output" &&
      action.actionKind === "solve-code"
        ? CODE_INVALID_OUTPUT_LABEL
        : action.suppressionReason === "invalid_output"
          ? `${SUPPRESSION["invalid_output"]?.label ?? ""}${flaggedBecause(parseWithheldCodes(action.result))}`
          : (SUPPRESSION[action.suppressionReason ?? ""]?.label ?? null),
    rejectedClaimCount:
      action.suppressionReason === "invalid_output"
        ? (parseWithheldResult(action.result)?.rejectedClaimCount ?? null)
        : null,
    withheldCodes:
      action.suppressionReason === "invalid_output"
        ? parseWithheldCodes(action.result)
        : [],
    profile: profileLine(action.result),
    current: action.taskRevision >= context.currentRevision,
    attempt: action.attempt,
    shown: action.shown,
    jobId: action.jobId,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

export const isRunInFlight = (run: ActivityRun): boolean =>
  run.state === "running" || run.state === "cancelling";
