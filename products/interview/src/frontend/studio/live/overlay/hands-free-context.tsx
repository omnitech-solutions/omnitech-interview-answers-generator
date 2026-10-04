// The one hands-free controller of a document, offered to everything in it: the
// Studio shell mounts the provider once, so the live view's band and the card
// opened inside the page are two views of the SAME microphone, share and Auto,
// never two of them. A document without the provider (the overlay window, the
// Picture-in-Picture frame, a test) gives each view its own controller, which
// still takes part in the one-owner rule across documents.
import { createContext, type ReactNode } from "react";
import { type HandsFree, useHandsFree } from "./use-hands-free";

export const HandsFreeContext = createContext<HandsFree | null>(null);

export function HandsFreeProvider({ children }: { children: ReactNode }) {
  const hf = useHandsFree("studio");
  return (
    <HandsFreeContext.Provider value={hf}>{children}</HandsFreeContext.Provider>
  );
}
