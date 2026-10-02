import type { Origin } from "@omnitech-assistant/contracts";
import type {
  HostHooks,
  SavedPrompt,
  Starter,
  Surface,
} from "@omnitech-assistant/react";
import { createContext, useContext } from "react";

export type StudioTheme = "light" | "dark";
// A live rehearsal hides the sidebar; strict mode also keeps the assistant
// closed.
export type StudioFocus = "live" | "strict" | null;

// How the assistant presents itself for the bound draft: what it says it
// can do, what it offers to start with, and what the header says it sees.
export type StudioAssistantView = {
  sees: string;
  description: string;
  starters: readonly Starter[];
  prompts: readonly SavedPrompt[];
  surfaces?: readonly Surface[] | undefined;
};

// What a mounted view lends the shell: the assistant draft it edits, and the
// actions the shell's commands can trigger in it. Hooks are read through a
// ref so the view can keep them current without re-binding.
export type StudioViewBinding = {
  origin?: Origin | undefined;
  // Without one, the assistant presents itself for the Workspace question.
  assistant?: StudioAssistantView | undefined;
  hooks?: { readonly current: HostHooks } | undefined;
  runTests?: (() => void) | undefined;
  // Reload this draft if it is the one open (the Playground channel wrote it).
  reloadDraft?: ((artifact: string) => void) | undefined;
};

export type StudioContextValue = {
  theme: StudioTheme;
  toggleTheme(): void;
  // The shell header's action area; a view may portal its toolbar into it.
  headerSlot: HTMLElement | null;
  // Returns the unbind function; the latest binding wins.
  bindView(binding: StudioViewBinding): () => void;
  refreshLists(): void;
  setFocus(focus: StudioFocus): void;
};

export const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio() {
  return useContext(StudioContext);
}
