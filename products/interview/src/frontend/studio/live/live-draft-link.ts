// The Workspace draft link the coding panel is given in the live view tests
// (null: no draft). A module of its own so the workspace-handoff mock can read
// it without importing the component tree it replaces.
export const draftLink: { current: { target: object; open(): void } | null } = {
  current: null,
};
