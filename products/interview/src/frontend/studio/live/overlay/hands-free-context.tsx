// The one hands-free controller of a document, offered to everything in it: the
// Studio shell mounts the provider once, so the live view's screenshots area
// and the missing-context actions share the SAME share and Auto, never two of
// them. A view without the provider says capture is not available. The
// controller still takes part in the one-owner rule across documents.
import { createContext, type ReactNode } from "react";
import { type HandsFree, useHandsFree } from "./use-hands-free";

export const HandsFreeContext = createContext<HandsFree | null>(null);

export function HandsFreeProvider({ children }: { children: ReactNode }) {
  const hf = useHandsFree("studio");
  return (
    <HandsFreeContext.Provider value={hf}>{children}</HandsFreeContext.Provider>
  );
}
