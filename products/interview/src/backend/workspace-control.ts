import {
  type PlaygroundExplanation,
  type PlaygroundPatch,
  type PlaygroundSnapshot,
  type PlaygroundValue,
} from "@omnitech/interview-playground-control";

const emptyPlayground: PlaygroundValue = {
  question: "",
  language: "auto",
  answer: null,
  notes: "",
  panel: "terminal",
  view: "playground",
  explanation: null,
  explanations: [],
  mockInterview: null,
};

interface PlaygroundControlStore {
  get(): PlaygroundSnapshot;
  reset(): PlaygroundSnapshot;
  appendExplanation(explanation: PlaygroundExplanation): PlaygroundSnapshot;
  set(patch: PlaygroundPatch): PlaygroundSnapshot;
}

function createStore(
  initialSnapshot?: PlaygroundSnapshot,
): PlaygroundControlStore {
  let snapshot: PlaygroundSnapshot = initialSnapshot ?? {
    revision: 0,
    updatedAt: new Date().toISOString(),
    value: emptyPlayground,
  };

  function update(value: PlaygroundValue): PlaygroundSnapshot {
    snapshot = {
      revision: snapshot.revision + 1,
      updatedAt: new Date().toISOString(),
      value,
    };
    return snapshot;
  }

  return {
    get: () => snapshot,
    appendExplanation: (explanation) => {
      const existing =
        snapshot.value.explanations ??
        (snapshot.value.explanation ? [snapshot.value.explanation] : []);
      return update({
        ...snapshot.value,
        view: "concept-lab",
        explanation,
        explanations: [...existing, explanation],
      });
    },
    set: (patch) => {
      const next = { ...snapshot.value, ...patch };
      if ("explanation" in patch) {
        next.explanations = patch.explanation ? [patch.explanation] : [];
      }
      return update(next);
    },
    reset: () => update(emptyPlayground),
  };
}

declare global {
  // The development server reloads modules independently. Keeping this small,
  // local-only control store on globalThis preserves commands across reloads.
  var interviewPlaygroundControlStore: PlaygroundControlStore | undefined;
}

const existingStore = globalThis.interviewPlaygroundControlStore;
export const playgroundControlStore =
  existingStore && typeof existingStore.appendExplanation === "function"
    ? existingStore
    : createStore(existingStore?.get());

globalThis.interviewPlaygroundControlStore = playgroundControlStore;
