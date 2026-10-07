import type { ReactNode } from "react";

// A wrapper that adds no box: it only marks what is inside as text the person
// reads and copies (the text cursor and selection, never a window drag).
export function TextSurface({ children }: { children: ReactNode }) {
  return (
    <div data-text-surface="" className="pn-contents">
      {children}
    </div>
  );
}
