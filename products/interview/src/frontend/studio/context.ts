import type { Origin } from "@omnitech-assistant/contracts";
import type { HostHooks } from "@omnitech-assistant/react";
import { createContext, useContext } from "react";

export type StudioTheme = "light" | "dark";

// What a mounted view lends the shell: the assistant draft it edits, and the
// actions the shell's commands can trigger in it. Hooks are read through a
// ref so the view can keep them current without re-binding.
export type StudioViewBinding = {
  origin?: Origin | undefined;
  hooks?: { readonly current: HostHooks } | undefined;
  runTests?: (() => void) | undefined;
};

export type StudioContextValue = {
  theme: StudioTheme;
  toggleTheme(): void;
  // The shell header's action area; a view may portal its toolbar into it.
  headerSlot: HTMLElement | null;
  // Returns the unbind function; the latest binding wins.
  bindView(binding: StudioViewBinding): () => void;
  refreshLists(): void;
};

export const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio() {
  return useContext(StudioContext);
}
