import type {
  MockInterviewControl,
  PlaygroundExplanation,
  PlaygroundSnapshot,
  StudioView,
} from "@omnitech/interview-playground-control";
import type { Draft } from "./workspace/use-canonical-draft";
import type { StudioNavigation, ViewId } from "./use-studio-route";
import { studioFetch } from "./studio-fetch";

// The Playground control channel (`interview-answers playground …`) as the
// studio applies it: questions and answers become Workspace drafts, views
// map onto studio views, explanations show in Briefings, and mock-interview
// commands drive Rehearsal.

export const CONTROL_PATH = "/api/v1/playground-control";
const STORAGE_KEY = "interview-studio.playground-control";

const VIEW_FOR: Record<StudioView, ViewId> = {
  playground: "work",
  "concept-lab": "briefings",
  "interview-preparation": "briefings",
  "mock-interview": "rehearsal",
};

export type ControlDraft = Pick<Draft, "question" | "notes" | "answer">;
export type RehearsalCommand = MockInterviewControl & { id: string };

// What this browser last applied, so a reload never applies a push twice
// and an unchanged draft is not rewritten by a later, unrelated patch.
export type AppliedControl = {
  key: string;
  draft: string | null;
  question: string | null;
  artifact: string | null;
  rehearsal: string | null;
};

export const snapshotKey = (snapshot: PlaygroundSnapshot) =>
  `${snapshot.revision}@${snapshot.updatedAt}`;

export function explanationsOf(
  snapshot: PlaygroundSnapshot,
): readonly PlaygroundExplanation[] {
  const { value } = snapshot;
  return value.explanations ?? (value.explanation ? [value.explanation] : []);
}

// [GUARD] Revision 0 is the empty store a fresh server starts with.
export function isNewSnapshot(
  snapshot: PlaygroundSnapshot,
  applied: AppliedControl | null,
) {
  return snapshot.revision > 0 && snapshotKey(snapshot) !== applied?.key;
}

export function draftOf(snapshot: PlaygroundSnapshot): ControlDraft | null {
  const { question, notes, answer } = snapshot.value;
  // An answer pushed without its question is titled by the answer.
  const text = question.trim() || answer?.title.trim() || "";
  if (!text) return null;
  return {
    question: text,
    notes,
    answer: answer as Draft["answer"],
  };
}

export type ControlPlan = {
  applied: AppliedControl;
  // Write this draft: "new" for a question not pushed before.
  write: { artifact: string; created: boolean; draft: ControlDraft } | null;
  // null: nothing to show (e.g. `playground reset`), so stay where you are.
  navigate: StudioNavigation | null;
  rehearsal: RehearsalCommand | null;
};

// [STRATEGY] Each part of a snapshot is applied only when it changed since
// the last one applied here; a new question opens a new Workspace draft, the
// same question updates the draft it opened.
export function planControl(
  snapshot: PlaygroundSnapshot,
  applied: AppliedControl | null,
  newArtifact: () => string,
): ControlPlan {
  const key = snapshotKey(snapshot);
  const draft = draftOf(snapshot);
  const draftPrint = draft ? JSON.stringify(draft) : null;
  let artifact = applied?.artifact ?? null;
  let write: ControlPlan["write"] = null;
  if (draft && draftPrint !== applied?.draft) {
    const sameQuestion =
      artifact !== null && applied?.question === draft.question;
    const target = sameQuestion ? artifact! : newArtifact();
    artifact = target;
    write = { artifact: target, created: !sameQuestion, draft };
  }

  const control = snapshot.value.mockInterview;
  const rehearsalPrint = control ? JSON.stringify(control) : null;
  const rehearsal =
    control && rehearsalPrint !== applied?.rehearsal
      ? { ...control, id: key }
      : null;

  const view = VIEW_FOR[snapshot.value.view] ?? "work";
  // A reset (or a panel-only patch) leaves an empty Workspace push.
  const empty = view === "work" && !draft;
  const navigate: StudioNavigation | null = empty
    ? null
    : view === "work"
      ? { view, ...(artifact ? { artifact } : {}) }
      : view === "briefings" &&
          snapshot.value.view === "concept-lab" &&
          explanationsOf(snapshot).length
        ? { view, rest: ["explanations"] }
        : { view };

  return {
    applied: {
      key,
      draft: draftPrint,
      question: draft?.question ?? applied?.question ?? null,
      artifact,
      rehearsal: rehearsalPrint,
    },
    write,
    navigate,
    rehearsal,
  };
}

export function readApplied(): AppliedControl | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as AppliedControl) : null;
  } catch {
    return null;
  }
}
export function storeApplied(applied: AppliedControl) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(applied));
  } catch {
    // Without storage a reload may re-apply the latest push; nothing is lost.
  }
}

// Writes a pushed draft through the same canonical API the Workspace uses:
// read (which creates a missing draft), then patch at that revision.
export async function writeControlDraft(
  workspaceId: string,
  artifact: string,
  draft: ControlDraft,
) {
  const path = `/api/interview/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifact)}`;
  const read = await studioFetch(path);
  if (!read.ok) throw new Error(`${read.status}`);
  const { origin } = (await read.json()) as { origin: unknown };
  const written = await studioFetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin, patch: draft }),
  });
  if (!written.ok) throw new Error(`${written.status}`);
}
