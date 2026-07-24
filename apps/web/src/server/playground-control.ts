import {
  type PlaygroundPatch,
  type PlaygroundSnapshot,
  type PlaygroundValue,
} from "@omnitech/interview-playground-control";

const emptyPlayground: PlaygroundValue = {
  question: "",
  language: "auto",
  answer: null,
  notes: "",
  panel: "notes",
};

interface PlaygroundControlStore {
  get(): PlaygroundSnapshot;
  reset(): PlaygroundSnapshot;
  set(patch: PlaygroundPatch): PlaygroundSnapshot;
}

function createStore(): PlaygroundControlStore {
  let snapshot: PlaygroundSnapshot = {
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
    set: (patch) => update({ ...snapshot.value, ...patch }),
    reset: () => update(emptyPlayground),
  };
}

declare global {
  // The development server reloads modules independently. Keeping this small,
  // local-only control store on globalThis preserves commands across reloads.
  var interviewPlaygroundControlStore: PlaygroundControlStore | undefined;
}

export const playgroundControlStore =
  globalThis.interviewPlaygroundControlStore ?? createStore();

globalThis.interviewPlaygroundControlStore = playgroundControlStore;
